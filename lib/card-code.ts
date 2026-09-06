import { createHash, randomInt } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeCardCode(value: string) {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function hashCardCode(value: string) {
  return createHash("sha256").update(normalizeCardCode(value)).digest("hex");
}

function randomBlock() {
  return Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

export function generateCardCode() {
  return `EH-${randomBlock()}-${randomBlock()}-${randomBlock()}`;
}
