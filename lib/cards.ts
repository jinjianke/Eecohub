import { randomUUID } from "node:crypto";
import { CARD_VALIDITY_DAYS, DEFAULT_PUBLIC_URL, DEFAULT_SITE_NAME } from "@/lib/config";
import { db } from "@/lib/db";
import { generateCardCode, hashCardCode, normalizeCardCode } from "@/lib/card-code";

export type CardStatus = "UNUSED" | "ACTIVE" | "EXPIRED" | "DISABLED";
export type CardRecord = {
  id: string;
  codeLast4: string;
  buyerId: string | null;
  status: CardStatus;
  siteName: string | null;
  publicUrl: string | null;
  createdAt: string;
  activatedAt: string | null;
  expiresAt: string | null;
  disabledAt: string | null;
  deploymentCount: number;
  lastDeploymentId: string | null;
  lastDeployedAt: string | null;
};

type CardRow = {
  id: string;
  code_last4: string;
  buyer_id: string | null;
  status: CardStatus;
  site_name: string | null;
  public_url: string | null;
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
  disabled_at: string | null;
  deployment_count: number;
  last_deployment_id: string | null;
  last_deployed_at: string | null;
};

function mapCard(row: CardRow): CardRecord {
  return {
    id: row.id,
    codeLast4: row.code_last4,
    buyerId: row.buyer_id,
    status: row.status,
    siteName: row.site_name,
    publicUrl: row.public_url,
    createdAt: row.created_at,
    activatedAt: row.activated_at,
    expiresAt: row.expires_at,
    disabledAt: row.disabled_at,
    deploymentCount: row.deployment_count,
    lastDeploymentId: row.last_deployment_id,
    lastDeployedAt: row.last_deployed_at,
  };
}

const cardSelect = `
  SELECT id, code_last4, buyer_id, status, site_name, public_url, created_at,
         activated_at, expires_at, disabled_at, deployment_count,
         last_deployment_id, last_deployed_at
  FROM cards
`;

function refreshExpiration(row: CardRow | undefined) {
  if (!row) return undefined;
  if (row.status === "ACTIVE" && row.expires_at && Date.parse(row.expires_at) <= Date.now()) {
    db.prepare("UPDATE cards SET status = 'EXPIRED' WHERE id = ? AND status = 'ACTIVE'").run(row.id);
    row.status = "EXPIRED";
  }
  return row;
}

export function findCardByCode(code: string) {
  const row = db.prepare(`${cardSelect} WHERE code_hash = ?`).get(hashCardCode(code)) as CardRow | undefined;
  const refreshed = refreshExpiration(row);
  return refreshed ? mapCard(refreshed) : null;
}

export function getCardById(id: string) {
  const row = db.prepare(`${cardSelect} WHERE id = ?`).get(id) as CardRow | undefined;
  const refreshed = refreshExpiration(row);
  return refreshed ? mapCard(refreshed) : null;
}

export function listCards() {
  const rows = db.prepare(`${cardSelect} ORDER BY created_at DESC`).all() as unknown as CardRow[];
  return rows.map((row) => mapCard(refreshExpiration(row)!));
}

export function generateCards(count: number, buyerId: string) {
  const safeCount = Math.max(1, Math.min(100, Math.floor(count)));
  const normalizedBuyerId = buyerId.trim();
  if (!normalizedBuyerId) throw new Error("请填写买家 ID。");
  if (normalizedBuyerId.length > 100) throw new Error("买家 ID 最多 100 个字符。");

  const insert = db.prepare(`
    INSERT INTO cards (id, code_hash, code_last4, buyer_id, status, created_at)
    VALUES (?, ?, ?, ?, 'UNUSED', ?)
  `);
  const generated: Array<{
    id: string;
    code: string;
    buyerId: string;
    status: CardStatus;
    createdAt: string;
  }> = [];

  db.exec("BEGIN IMMEDIATE");
  try {
    while (generated.length < safeCount) {
      const code = generateCardCode();
      const createdAt = new Date().toISOString();
      try {
        const id = randomUUID();
        insert.run(id, hashCardCode(code), normalizeCardCode(code).slice(-4), normalizedBuyerId, createdAt);
        generated.push({ id, code, buyerId: normalizedBuyerId, status: "UNUSED", createdAt });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("UNIQUE")) throw error;
      }
    }
    db.exec("COMMIT");
    return generated;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function setCardStatus(id: string, action: "disable" | "enable" | "expire") {
  const card = getCardById(id);
  if (!card) throw new Error("卡密不存在。");

  if (action === "disable") {
    db.prepare("UPDATE cards SET status = 'DISABLED', disabled_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  } else if (action === "expire") {
    db.prepare("UPDATE cards SET status = 'EXPIRED', expires_at = ? WHERE id = ?")
      .run(new Date().toISOString(), id);
  } else if (card.activatedAt) {
    db.prepare("UPDATE cards SET status = 'ACTIVE', disabled_at = NULL WHERE id = ?").run(id);
  } else {
    db.prepare("UPDATE cards SET status = 'UNUSED', expires_at = NULL, disabled_at = NULL WHERE id = ?").run(id);
  }

  return getCardById(id)!;
}

export function extendCard(id: string, days: number) {
  const safeDays = Math.max(1, Math.min(3650, Math.floor(days)));
  const card = getCardById(id);
  if (!card) throw new Error("卡密不存在。");
  if (!card.activatedAt) throw new Error("未激活卡密不能延期。");

  const base = card.expiresAt && Date.parse(card.expiresAt) > Date.now()
    ? Date.parse(card.expiresAt)
    : Date.now();
  const expiresAt = new Date(base + safeDays * 24 * 60 * 60 * 1000).toISOString();
  db.prepare("UPDATE cards SET expires_at = ?, status = 'ACTIVE', disabled_at = NULL WHERE id = ?")
    .run(expiresAt, id);
  return getCardById(id)!;
}

export function allocateAvailableSite(cardId: string) {
  const card = getCardById(cardId);
  if (!card) throw new Error("卡密不存在。");
  if (card.siteName && card.publicUrl) return card;

  db.exec("BEGIN IMMEDIATE");
  try {
    const latestCard = getCardById(cardId);
    if (!latestCard) throw new Error("卡密不存在。");
    if (latestCard.siteName && latestCard.publicUrl) {
      db.exec("COMMIT");
      return latestCard;
    }

    const site = db.prepare(`
      SELECT name, public_url FROM sites
      WHERE status = 'AVAILABLE' AND allocated_card_id IS NULL
      ORDER BY created_at ASC LIMIT 1
    `).get() as { name: string; public_url: string } | undefined;
    if (!site) {
      db.exec("COMMIT");
      return null;
    }

    db.prepare("UPDATE sites SET status = 'ALLOCATED', allocated_card_id = ? WHERE name = ?")
      .run(cardId, site.name);
    db.prepare("UPDATE cards SET site_name = ?, public_url = ? WHERE id = ?")
      .run(site.name, site.public_url, cardId);
    db.exec("COMMIT");
    return getCardById(cardId)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function bindCreatedSiteToCard(cardId: string, siteName: string, publicUrl: string) {
  const cleanName = siteName.trim().toLowerCase();
  const cleanUrl = publicUrl.trim().replace(/\/$/, "");
  if (!cleanName || !cleanUrl) throw new Error("热铁盒返回的网站信息不完整。");

  db.exec("BEGIN IMMEDIATE");
  try {
    const card = getCardById(cardId);
    if (!card) throw new Error("卡密不存在。");

    if (card.siteName && card.publicUrl) {
      if (card.siteName !== cleanName) {
        db.prepare(`
          INSERT INTO sites (name, public_url, status, allocated_card_id, created_at)
          VALUES (?, ?, 'AVAILABLE', NULL, ?)
          ON CONFLICT(name) DO UPDATE SET public_url = excluded.public_url
        `).run(cleanName, cleanUrl, new Date().toISOString());
      }
      db.exec("COMMIT");
      return card;
    }

    const existingSite = db.prepare("SELECT allocated_card_id FROM sites WHERE name = ?")
      .get(cleanName) as { allocated_card_id: string | null } | undefined;
    if (existingSite?.allocated_card_id && existingSite.allocated_card_id !== cardId) {
      throw new Error("新创建的网站已被其他卡密占用，请重新部署。");
    }

    db.prepare(`
      INSERT INTO sites (name, public_url, status, allocated_card_id, created_at)
      VALUES (?, ?, 'ALLOCATED', ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        public_url = excluded.public_url,
        status = 'ALLOCATED',
        allocated_card_id = excluded.allocated_card_id
    `).run(cleanName, cleanUrl, cardId, new Date().toISOString());
    db.prepare("UPDATE cards SET site_name = ?, public_url = ? WHERE id = ?")
      .run(cleanName, cleanUrl, cardId);
    db.exec("COMMIT");
    return getCardById(cardId)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordSuccessfulDeployment(input: {
  cardId: string;
  deploymentId: string;
  deployedAt: string;
  fileName: string;
  fileCount: number;
  extractedBytes: number;
}) {
  const card = getCardById(input.cardId);
  if (!card) throw new Error("卡密不存在。");
  const siteName = card.siteName || DEFAULT_SITE_NAME;
  const publicUrl = card.publicUrl || DEFAULT_PUBLIC_URL;
  const activatedAt = card.activatedAt || input.deployedAt;
  const expiresAt = card.expiresAt || new Date(
    Date.parse(activatedAt) + CARD_VALIDITY_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE cards SET
        status = 'ACTIVE', site_name = ?, public_url = ?, activated_at = ?, expires_at = ?,
        deployment_count = deployment_count + 1,
        last_deployment_id = ?, last_deployed_at = ?, disabled_at = NULL
      WHERE id = ?
    `).run(siteName, publicUrl, activatedAt, expiresAt, input.deploymentId, input.deployedAt, input.cardId);

    db.prepare(`
      INSERT INTO deployments (
        id, card_id, site_name, status, file_name, file_count, extracted_bytes, created_at
      ) VALUES (?, ?, ?, 'SUCCESS', ?, ?, ?, ?)
    `).run(
      input.deploymentId,
      input.cardId,
      siteName,
      input.fileName,
      input.fileCount,
      input.extractedBytes,
      input.deployedAt,
    );
    db.exec("COMMIT");
    return getCardById(input.cardId)!;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function recordFailedDeployment(input: {
  cardId: string;
  deploymentId: string;
  fileName: string;
  errorMessage: string;
}) {
  const card = getCardById(input.cardId);
  if (!card?.siteName) return;
  db.prepare(`
    INSERT OR REPLACE INTO deployments (
      id, card_id, site_name, status, file_name, created_at, error_message
    ) VALUES (?, ?, ?, 'FAILED', ?, ?, ?)
  `).run(
    input.deploymentId,
    input.cardId,
    card.siteName,
    input.fileName,
    new Date().toISOString(),
    input.errorMessage.slice(0, 1000),
  );
}

export function getCardStats() {
  db.prepare("UPDATE cards SET status = 'EXPIRED' WHERE status = 'ACTIVE' AND expires_at IS NOT NULL AND expires_at <= ?")
    .run(new Date().toISOString());
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM cards GROUP BY status").all() as unknown as Array<{ status: CardStatus; count: number }>;
  const stats: Record<CardStatus | "TOTAL", number> = { TOTAL: 0, UNUSED: 0, ACTIVE: 0, EXPIRED: 0, DISABLED: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.count);
    stats.TOTAL += Number(row.count);
  }
  return stats;
}

export function getSiteStats() {
  const rows = db.prepare("SELECT status, COUNT(*) AS count FROM sites GROUP BY status").all() as unknown as Array<{
    status: "AVAILABLE" | "ALLOCATED" | "DISABLED";
    count: number;
  }>;
  const stats = { TOTAL: 0, AVAILABLE: 0, ALLOCATED: 0, DISABLED: 0 };
  for (const row of rows) {
    stats[row.status] = Number(row.count);
    stats.TOTAL += Number(row.count);
  }
  return stats;
}
