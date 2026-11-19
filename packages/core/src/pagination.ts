import { AppError } from "./errors";

/** Opaque cursor pagination (uuid v7 ids are time-ordered, so the id alone is a stable cursor). */
export interface Cursor { id: string }

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(raw: string): Cursor {
  try {
    if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) {
      throw new Error("bad length");
    }
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("bad shape");
    }
    const id = (parsed as { id?: unknown }).id;
    if (typeof id !== "string" || id.length === 0 || id.length > 128 || id.includes(String.fromCharCode(0))) {
      throw new Error("bad id");
    }
    return { id };
  } catch {
    throw new AppError("INVALID_CURSOR", "Invalid pagination cursor", 400);
  }
}

export function parseLimit(raw: string | number | undefined | null): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  if (n === undefined || n === null || !Number.isFinite(n)) return 25;
  return Math.min(100, Math.max(1, Math.floor(n)));
}
