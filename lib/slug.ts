const ALPHABET = "abcdefghijkmnopqrstuvwxyz23456789";

export function createSlug(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

export function normalizeSlug(input: string): string | null {
  const slug = input.trim().toLowerCase();
  if (!slug) return null;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length < 3 || slug.length > 32) {
    return null;
  }
  return slug;
}

export const MAX_TAGS = 12;

const TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function normalizeTag(input: string): string | null {
  const tag = input.trim().toLowerCase();
  if (!tag || tag.length > 24 || !TAG_PATTERN.test(tag)) return null;
  return tag;
}

export function parseTags(input: string): { ok: true; tags: string[] } | { ok: false; error: string } {
  const parts = input
    .split(/[,\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length === 0) return { ok: true, tags: [] };
  if (parts.length > MAX_TAGS) {
    return { ok: false, error: `Use up to ${MAX_TAGS} tags.` };
  }

  const tags: string[] = [];
  for (const part of parts) {
    const tag = normalizeTag(part);
    if (!tag) {
      return { ok: false, error: "Tags use 1–24 letters, numbers, and hyphens." };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  return { ok: true, tags };
}

export function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

// Keeps a hosted page well under the 1 MB server action body limit.
export const MAX_PAGE_BYTES = 512 * 1024;

export function normalizePageHtml(
  input: string,
): { ok: true; html: string } | { ok: false; error: string } {
  const html = input.trim();
  if (!html) return { ok: false, error: "Paste the page HTML or load an .html file." };
  if (new TextEncoder().encode(html).length > MAX_PAGE_BYTES) {
    return { ok: false, error: "The page is over 512 KB. Host images elsewhere and link to them." };
  }
  return { ok: true, html };
}
