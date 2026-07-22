import { describe, expect, it } from "vitest";
import { greet } from "./greet.js";

describe("greet", () => {
  it("greets a given name", () => {
    expect(greet("Ada")).toBe("Hello, Ada!");
  });

  it("falls back to 'world' for empty input", () => {
    expect(greet("")).toBe("Hello, world!");
    expect(greet("   ")).toBe("Hello, world!");
  });

  it("trims surrounding whitespace", () => {
    expect(greet("  Grace  ")).toBe("Hello, Grace!");
  });
});
