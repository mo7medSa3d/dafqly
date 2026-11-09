import { describe, it, expect } from "vitest";
import { normalizeEgPhone, PhoneError, maskPhone } from "./phone";

describe("normalizeEgPhone", () => {
  it("normalizes local, international and 00-prefixed Egyptian mobiles to E.164", () => {
    expect(normalizeEgPhone("01001234567").e164).toBe("+201001234567");
    expect(normalizeEgPhone("+20 100 123 4567").e164).toBe("+201001234567");
    expect(normalizeEgPhone("00201001234567").e164).toBe("+201001234567");
  });
  it("accepts Eastern Arabic digits", () => {
    expect(normalizeEgPhone("٠١٠٠١٢٣٤٥٦٧").e164).toBe("+201001234567");
  });
  it("is idempotent", () => {
    const once = normalizeEgPhone("01001234567");
    expect(normalizeEgPhone(once.e164)).toEqual(once);
  });
  it("flags mobiles as WhatsApp-capable even when libphonenumber has no type metadata (M1 regression)", () => {
    for (const n of ["01001234567", "01112345678", "01221234567", "01551234567", "01007007001"]) {
      const p = normalizeEgPhone(n);
      expect(p.isMobile, n).toBe(true);
      expect(p.whatsappCapable, n).toBe(true);
    }
  });
  it("flags landlines as not WhatsApp-capable", () => {
    const landline = normalizeEgPhone("02 2345 6789");
    expect(landline.isMobile).toBe(false);
    expect(landline.whatsappCapable).toBe(false);
  });
  it("rejects invalid numbers", () => {
    expect(() => normalizeEgPhone("12345")).toThrow(PhoneError);
    expect(() => normalizeEgPhone("")).toThrow(PhoneError);
  });
});

describe("maskPhone (M6, §8 no PII in logs)", () => {
  it("keeps only country code + last two digits", () => {
    expect(maskPhone("+201012345678")).toBe("+20*****78");
    expect(maskPhone("01012345678")).toBe("+01*****78"); // digits-only input still masked
    expect(maskPhone("+201012345678")).not.toContain("12345");
  });
  it("fully masks short/garbage input and handles null", () => {
    expect(maskPhone("123")).toBe("*****");
    expect(maskPhone(null)).toBe("(none)");
    expect(maskPhone(undefined)).toBe("(none)");
  });
});
