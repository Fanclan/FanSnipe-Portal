import { describe, expect, it } from "vitest";
import { canonicalSite } from "../config/site.mjs";
describe("canonical site", () => {
  it("uses the confirmed domain and normalizes secure origin overrides", () => {
    expect(canonicalSite("")).toBe("https://fansnipe.com");
    expect(canonicalSite("https://example.org/")).toBe("https://example.org");
  });
  it("rejects non-HTTPS and URLs with credentials, paths, queries or fragments", () => {
    for (const value of [
      "http://example.org",
      "https://u:p@example.org",
      "https://example.org/path",
      "https://example.org/?x=1",
      "https://example.org/#fragment",
      "not a URL",
    ])
      expect(() => canonicalSite(value)).toThrow(/PUBLIC_SITE_URL/);
  });
});
