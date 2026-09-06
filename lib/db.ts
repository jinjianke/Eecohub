import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import {
  DATABASE_FILE,
  DEFAULT_PUBLIC_URL,
  DEFAULT_SITE_NAME,
  LEGACY_CARD_CODE,
  LEGACY_STATE_FILE,
  RUNTIME_DIR,
} from "@/lib/config";
import { hashCardCode, normalizeCardCode } from "@/lib/card-code";

const globalDatabase = globalThis as typeof globalThis & { __eecohubDb?: DatabaseSync };

function createDatabase() {
  mkdirSync(RUNTIME_DIR, { recursive: true });
  const database = new DatabaseSync(DATABASE_FILE);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL UNIQUE,
      code_last4 TEXT NOT NULL,
      buyer_id TEXT,
      status TEXT NOT NULL DEFAULT 'UNUSED'
        CHECK (status IN ('UNUSED', 'ACTIVE', 'EXPIRED', 'DISABLED')),
      site_name TEXT,
      public_url TEXT,
      created_at TEXT NOT NULL,
      activated_at TEXT,
      expires_at TEXT,
      disabled_at TEXT,
      deployment_count INTEGER NOT NULL DEFAULT 0,
      last_deployment_id TEXT,
      last_deployed_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_cards_status ON cards(status);
    CREATE INDEX IF NOT EXISTS idx_cards_created_at ON cards(created_at DESC);

    CREATE TABLE IF NOT EXISTS sites (
      name TEXT PRIMARY KEY,
      public_url TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'AVAILABLE'
        CHECK (status IN ('AVAILABLE', 'ALLOCATED', 'DISABLED')),
      allocated_card_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      FOREIGN KEY (allocated_card_id) REFERENCES cards(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS deployments (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      site_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED')),
      file_name TEXT NOT NULL,
      file_count INTEGER,
      extracted_bytes INTEGER,
      created_at TEXT NOT NULL,
      error_message TEXT,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_deployments_card ON deployments(card_id, created_at DESC);
  `);

  migrateCardBuyerId(database);
  migrateLegacyData(database);
  return database;
}


function migrateCardBuyerId(database: DatabaseSync) {
  const columns = database.prepare("PRAGMA table_info(cards)").all() as unknown as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "buyer_id")) {
    database.exec("ALTER TABLE cards ADD COLUMN buyer_id TEXT");
  }
  database.exec("CREATE INDEX IF NOT EXISTS idx_cards_buyer_id ON cards(buyer_id)");
}

function migrateLegacyData(database: DatabaseSync) {
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO sites (name, public_url, status, created_at)
    VALUES (?, ?, 'AVAILABLE', ?)
    ON CONFLICT(name) DO UPDATE SET public_url = excluded.public_url
  `).run(DEFAULT_SITE_NAME, DEFAULT_PUBLIC_URL, now);

  if (!LEGACY_CARD_CODE) return;
  const normalized = normalizeCardCode(LEGACY_CARD_CODE);
  const codeHash = hashCardCode(normalized);
  const existing = database.prepare("SELECT id FROM cards WHERE code_hash = ?").get(codeHash);
  if (existing) return;

  let legacy: Record<string, unknown> = {};
  try {
    legacy = JSON.parse(readFileSync(LEGACY_STATE_FILE, "utf8"));
  } catch {}

  const status = ["UNUSED", "ACTIVE", "EXPIRED", "DISABLED"].includes(String(legacy.status))
    ? String(legacy.status)
    : "UNUSED";
  const siteName = typeof legacy.site === "string" ? legacy.site : status === "ACTIVE" ? DEFAULT_SITE_NAME : null;
  const publicUrl = siteName ? DEFAULT_PUBLIC_URL : null;
  const cardId = randomUUID();

  database.prepare(`
    INSERT INTO cards (
      id, code_hash, code_last4, status, site_name, public_url, created_at,
      activated_at, expires_at, deployment_count, last_deployment_id, last_deployed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cardId,
    codeHash,
    normalized.slice(-4),
    status,
    siteName,
    publicUrl,
    now,
    typeof legacy.activatedAt === "string" ? legacy.activatedAt : null,
    typeof legacy.expiresAt === "string" ? legacy.expiresAt : null,
    typeof legacy.deploymentCount === "number" ? legacy.deploymentCount : 0,
    typeof legacy.lastDeploymentId === "string" ? legacy.lastDeploymentId : null,
    typeof legacy.lastDeployedAt === "string" ? legacy.lastDeployedAt : null,
  );

  if (siteName) {
    database.prepare(`
      INSERT INTO sites (name, public_url, status, allocated_card_id, created_at)
      VALUES (?, ?, 'ALLOCATED', ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        public_url = excluded.public_url,
        status = 'ALLOCATED',
        allocated_card_id = excluded.allocated_card_id
    `).run(siteName, publicUrl, cardId, now);
  }
}

export const db = globalDatabase.__eecohubDb ?? createDatabase();
if (process.env.NODE_ENV !== "production") globalDatabase.__eecohubDb = db;
