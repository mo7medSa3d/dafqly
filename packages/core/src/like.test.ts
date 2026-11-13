import { describe, it, expect } from "vitest";
import { escapeLike, likePattern } from "./like";

describe("escapeLike (L2)", () => {
  it("escapes %, _ and backslash so they match literally", () => {
    expect(escapeLike("100%_x\\y")).toBe("100\\%\\_x\\\\y");
    expect(escapeLike("plain")).toBe("plain");
    expect(escapeLike("")).toBe("");
  });
  it("likePattern wraps the escaped term as a contains pattern", () => {
    expect(likePattern("50%")).toBe("%50\\%%");
    expect(likePattern("a_b")).toBe("%a\\_b%");
  });
});
