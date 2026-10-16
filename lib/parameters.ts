// Rules for tracking parameters and their values. Shared by server and client code; the server
// always re-checks, whatever the form already checked.

export const PARAMETER_TYPES = ["text", "dropdown"] as const;
export type ParameterType = (typeof PARAMETER_TYPES)[number];

export const PARAMETER_TYPE_LABELS: Record<ParameterType, string> = {
  text: "Text — typed in",
  dropdown: "Dropdown — picked from a list",
};

export const MAX_PARAMETERS = 30;
export const MAX_OPTIONS = 5000;
export const MAX_IMPORT_ROWS = 2000;
export const MAX_TEXT_VALUE = 200;

const KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

export function isParameterType(value: unknown): value is ParameterType {
  return typeof value === "string" && (PARAMETER_TYPES as readonly string[]).includes(value);
}

export function normalizeKey(input: string): string | null {
  const key = input.trim().toLowerCase();
  return KEY_PATTERN.test(key) ? key : null;
}

// A starting key for the form, from the display name: "Store Code" → store_code.
export function suggestKey(name: string): string {
  const key = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^[^a-z]+|_+$/g, "")
    .slice(0, 40);
  return key.replace(/_+$/, "");
}

export type ParameterInput = {
  name: string;
  description: string | null;
  isRequired: boolean;
};

export function parseParameterFields(fields: {
  name: string;
  description: string;
  isRequired: boolean;
}): { ok: true; value: ParameterInput } | { ok: false; error: string } {
  const name = fields.name.trim();
  if (!name || name.length > 60 || CONTROL.test(name)) {
    return { ok: false, error: "Enter a name of up to 60 characters." };
  }
  const description = fields.description.trim();
  if (description.length > 300) return { ok: false, error: "Keep the description under 300 characters." };
  return {
    ok: true,
    value: { name, description: description || null, isRequired: fields.isRequired },
  };
}

export function normalizeOptionValue(input: string): string | null {
  const value = input.trim();
  if (!value || value.length > 64 || CONTROL.test(value)) return null;
  return value;
}

export function normalizeOptionLabel(input: string): string | null | false {
  const label = input.trim();
  if (!label) return null;
  if (label.length > 120 || CONTROL.test(label)) return false;
  return label;
}

export type OptionRow = { value: string; label: string | null };

// Pasted lines or CSV rows: "value" or "value,label" (a tab also separates). A header row
// starting with "value" is skipped. Quotes around a field are removed.
export function parseOptionRows(
  input: string,
): { ok: true; rows: OptionRow[] } | { ok: false; error: string } {
  const lines = input.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length && /^"?value"?\s*([,\t]|$)/i.test(lines[0])) lines.shift();
  if (lines.length === 0) return { ok: false, error: "Enter at least one value." };
  if (lines.length > MAX_IMPORT_ROWS) {
    return { ok: false, error: `Import up to ${MAX_IMPORT_ROWS} values at a time.` };
  }

  const rows: OptionRow[] = [];
  const seen = new Set<string>();
  for (const [index, line] of lines.entries()) {
    const split = line.search(/[,\t]/);
    const rawValue = unquote(split === -1 ? line : line.slice(0, split));
    const rawLabel = split === -1 ? "" : unquote(line.slice(split + 1));
    const value = normalizeOptionValue(rawValue);
    if (!value) return { ok: false, error: `Line ${index + 1}: values use 1–64 characters.` };
    const label = normalizeOptionLabel(rawLabel);
    if (label === false) return { ok: false, error: `Line ${index + 1}: labels use up to 120 characters.` };
    const folded = value.toLowerCase();
    if (seen.has(folded)) return { ok: false, error: `Line ${index + 1}: "${value}" appears more than once.` };
    seen.add(folded);
    rows.push({ value, label });
  }
  return { ok: true, rows };
}

function unquote(field: string): string {
  const trimmed = field.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1).replace(/""/g, '"').trim()
    : trimmed;
}

export type ParameterDefinition = {
  id: string;
  key: string;
  name: string;
  fieldType: ParameterType;
  isRequired: boolean;
  isActive: boolean;
  options: { id: string; value: string; isActive: boolean }[];
};

export type ParameterValue = { parameterId: string; key: string; value: string; optionId: string | null };

// Checks submitted values (by key) against a workspace's parameters. Only active parameters and
// active options are accepted; dropdown values match regardless of case and are stored as defined.
export function validateParameterValues(
  definitions: ParameterDefinition[],
  input: Record<string, string>,
): { ok: true; values: ParameterValue[] } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const values: ParameterValue[] = [];
  const active = definitions.filter((d) => d.isActive);
  const known = new Set(active.map((d) => d.key));

  for (const key of Object.keys(input)) {
    if (!known.has(key)) errors[key] = "This parameter is not available.";
  }

  for (const definition of active) {
    const raw = (input[definition.key] ?? "").trim();
    if (!raw) {
      if (definition.isRequired) errors[definition.key] = `${definition.name} is required.`;
      continue;
    }
    if (definition.fieldType === "dropdown") {
      const option = definition.options.find((o) => o.isActive && o.value.toLowerCase() === raw.toLowerCase());
      if (!option) {
        errors[definition.key] = `"${raw}" is not an option for ${definition.name}.`;
        continue;
      }
      values.push({ parameterId: definition.id, key: definition.key, value: option.value, optionId: option.id });
    } else {
      if (raw.length > MAX_TEXT_VALUE || CONTROL.test(raw)) {
        errors[definition.key] = `${definition.name} uses up to ${MAX_TEXT_VALUE} characters.`;
        continue;
      }
      values.push({ parameterId: definition.id, key: definition.key, value: raw, optionId: null });
    }
  }

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, values };
}
