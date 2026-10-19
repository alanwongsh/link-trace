// Time-ordered UUID (v7), the same kind the database makes with uuid_v7(), for ids made in the
// app before a row is written (such as a click waiting in the queue). No imports.
export function uuidv7(now = Date.now()): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  // 48-bit millisecond time, big-endian; exact in a double.
  for (let i = 0; i < 6; i += 1) bytes[i] = Math.floor(now / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
