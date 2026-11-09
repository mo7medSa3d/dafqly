import { describe, it, expect } from "vitest";
import { AppError, toApiErrorBody } from "./errors";
import { encodeCursor, decodeCursor, parseLimit } from "./pagination";
import { requireIdempotencyKey } from "./idempotency";

describe("uniform API error shape", () => {
  it("serializes AppError to { error: { code, message, details } }", () => {
    const body = toApiErrorBody(new AppError("NOT_FOUND", "Invoice not found", 404, { id: "x" }));
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "Invoice not found", details: { id: "x" } } });
  });
  it("never leaks internals for unknown errors", () => {
    const body = toApiErrorBody(new Error("pg password hunter2"));
    expect(body.error.code).toBe("INTERNAL");
    expect(body.error.message).not.toContain("hunter2");
  });
});
describe("cursor pagination", () => {
  it("round-trips a cursor and rejects garbage", () => {
    const c = encodeCursor({ id: "0193e1a2-0000-7000-8000-000000000001" });
    expect(decodeCursor(c)).toEqual({ id: "0193e1a2-0000-7000-8000-000000000001" });
    expect(() => decodeCursor("not-a-cursor!!")).toThrow(AppError);
  });
  it("clamps limits to 1..100 with default 25", () => {
    expect(parseLimit(undefined)).toBe(25);
    expect(parseLimit("500")).toBe(100);
    expect(parseLimit("0")).toBe(1);
    expect(parseLimit("abc")).toBe(25);
  });
});
describe("idempotency guard for send-triggering POSTs", () => {
  it("returns the key when present and valid", () => {
    expect(requireIdempotencyKey(new Headers({ "idempotency-key": "abc12345-key" }))).toBe("abc12345-key");
  });
  it("throws a uniform 400 when missing or too short", () => {
    expect(() => requireIdempotencyKey(new Headers())).toThrow(AppError);
    try { requireIdempotencyKey(new Headers()); } catch (e) {
      expect(toApiErrorBody(e).error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
    expect(() => requireIdempotencyKey(new Headers({ "idempotency-key": "x" }))).toThrow(AppError);
  });
});
