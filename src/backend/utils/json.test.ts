import { describe, expect, it } from "vitest";
import { parseJson } from "./json";

describe("parseJson", () => {
  describe("one-arg form (no fallback)", () => {
    it("parses valid JSON", () => {
      expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    });

    it("returns null for null input", () => {
      expect(parseJson(null)).toBeNull();
    });

    it("returns null for invalid JSON", () => {
      expect(parseJson("not json")).toBeNull();
    });
  });

  describe("two-arg form (with fallback)", () => {
    it("parses valid JSON", () => {
      expect(parseJson('{"a":1}', { fallback: true })).toEqual({ a: 1 });
    });

    it("returns fallback for null input", () => {
      expect(parseJson(null, [])).toEqual([]);
    });

    it("returns fallback for invalid JSON", () => {
      expect(parseJson("not json", "default")).toBe("default");
    });
  });
});
