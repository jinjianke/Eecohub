import path from "node:path";

export const ROOT_DIR = process.cwd();
export const RUNTIME_DIR = path.join(ROOT_DIR, ".runtime");
export const DEPLOYMENTS_DIR = path.join(RUNTIME_DIR, "deployments");
export const DATABASE_FILE = path.join(RUNTIME_DIR, "eecohub.sqlite");
export const LEGACY_STATE_FILE = path.join(RUNTIME_DIR, "card-state.json");

export const DEFAULT_SITE_NAME = process.env.RTH_SITE?.trim() || "eecohub02";
export const DEFAULT_PUBLIC_URL = (
  process.env.RTH_PUBLIC_URL?.trim() || `https://${DEFAULT_SITE_NAME}.rth1.xyz`
).replace(/\/$/, "");
export const LEGACY_CARD_CODE = process.env.EECOHUB_CARD_CODE?.trim() || "";
export const ADMIN_PASSWORD = process.env.EECOHUB_ADMIN_PASSWORD?.trim() || "";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
export const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_COUNT = 1000;
export const DEPLOY_TIMEOUT_MS = 180_000;
export const CARD_VALIDITY_DAYS = 365;
