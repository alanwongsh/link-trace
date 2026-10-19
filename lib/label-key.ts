// The identity of a placement: its name (CSV uploads may set one) and which parameters it has with
// their values, regardless of order or case. Two placements with the same key cannot be told apart
// in lists or reports, so only one active placement per link may have it (placements.label_key,
// unique among active placements). No imports, so the worker and scripts can load it directly.
// Migration 0012 builds the same string in SQL for older rows; keep the two in step.
export function labelKey(values: { parameterId: string; value: string }[], name?: string | null): string {
  const labels = values.map((v) => `${v.parameterId}=${v.value.toLowerCase()}`).sort();
  return [`name=${(name ?? "").trim().toLowerCase()}`, ...labels].join("|");
}

// The unique index that enforces it, as named in the database.
export const LABEL_KEY_INDEX = "placements_active_label_key";
