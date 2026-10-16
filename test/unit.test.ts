import { describe, expect, it } from "vitest";
import { atLeast } from "@/lib/roles";
import { MAX_TAGS, normalizeSlug, normalizeTag, normalizeUrl, parseTags } from "@/lib/slug";
import { describeClick, isPrefetch } from "@/lib/track";

describe("tags", () => {
  it("parses several tags, lower-cased and de-duplicated", () => {
    expect(parseTags("Email, lark\nemail")).toEqual({ ok: true, tags: ["email", "lark"] });
  });

  it("allows no tags", () => {
    expect(parseTags("  ")).toEqual({ ok: true, tags: [] });
  });

  it("rejects invalid tags and more than the limit", () => {
    expect(parseTags("bad tag").ok).toBe(false);
    expect(parseTags(Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`).join(",")).ok).toBe(false);
  });

  it("normalizes a tag from a URL", () => {
    expect(normalizeTag("EMAIL")).toBe("email");
    expect(normalizeTag("other-tag")).toBe("other-tag");
    expect(normalizeTag("a".repeat(25))).toBeNull();
    expect(normalizeTag("no_underscores")).toBeNull();
  });
});

describe("slugs and URLs", () => {
  it("accepts 3–32 letters, numbers and hyphens", () => {
    expect(normalizeSlug("Promo-2026")).toBe("promo-2026");
    expect(normalizeSlug("ab")).toBeNull();
    expect(normalizeSlug("a--b")).toBeNull();
  });

  it("accepts only http and https destinations", () => {
    expect(normalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://example.com")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

describe("click classification", () => {
  const browser = {
    "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1",
    "sec-fetch-mode": "navigate",
  };

  it("counts a browser navigation as a person", () => {
    expect(describeClick(new Request("http://x/r/a", { headers: browser })).isBot).toBe(false);
  });

  it("flags bot user agents and non-navigation requests", () => {
    const bot = { ...browser, "user-agent": "Slackbot-LinkExpanding 1.0" };
    expect(describeClick(new Request("http://x/r/a", { headers: bot })).isBot).toBe(true);
    const fetchMode = { ...browser, "sec-fetch-mode": "cors" };
    expect(describeClick(new Request("http://x/r/a", { headers: fetchMode })).isBot).toBe(true);
  });

  it("detects prefetches", () => {
    expect(isPrefetch(new Request("http://x", { headers: { purpose: "prefetch" } }))).toBe(true);
    expect(isPrefetch(new Request("http://x", { headers: { "sec-purpose": "prefetch;prerender" } }))).toBe(true);
    expect(isPrefetch(new Request("http://x"))).toBe(false);
  });
});

describe("roles", () => {
  it("ranks viewer < editor < owner", () => {
    expect(atLeast("owner", "editor")).toBe(true);
    expect(atLeast("editor", "editor")).toBe(true);
    expect(atLeast("viewer", "editor")).toBe(false);
    expect(atLeast(null, "viewer")).toBe(false);
  });
});
