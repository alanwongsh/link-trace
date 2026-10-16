import { describe, expect, it } from "vitest";
import {
  normalizeKey,
  parseOptionRows,
  parseParameterFields,
  suggestKey,
  validateParameterValues,
  type ParameterDefinition,
} from "@/lib/parameters";

describe("parameter keys", () => {
  it("accepts lower-case letters, numbers and underscores, starting with a letter", () => {
    expect(normalizeKey(" Store_Code ")).toBe("store_code");
    expect(normalizeKey("booth_id2")).toBe("booth_id2");
    expect(normalizeKey("2store")).toBeNull();
    expect(normalizeKey("store-code")).toBeNull();
    expect(normalizeKey("a".repeat(41))).toBeNull();
  });

  it("suggests a key from the name", () => {
    expect(suggestKey("Store Code")).toBe("store_code");
    expect(suggestKey("  #1 Event ID! ")).toBe("event_id");
  });

  it("requires a name", () => {
    expect(parseParameterFields({ name: " ", description: "", isRequired: false }).ok).toBe(false);
    expect(parseParameterFields({ name: "Store", description: " ", isRequired: true })).toEqual({
      ok: true,
      value: { name: "Store", description: null, isRequired: true },
    });
  });
});

describe("option import", () => {
  it("reads values with optional labels, from pasted lines or CSV", () => {
    expect(parseOptionRows("value,label\nKL001,Mid Valley\n\"PG002\",\"Gurney, Penang\"\nJB003")).toEqual({
      ok: true,
      rows: [
        { value: "KL001", label: "Mid Valley" },
        { value: "PG002", label: "Gurney, Penang" },
        { value: "JB003", label: null },
      ],
    });
    expect(parseOptionRows("A\tAlpha")).toEqual({ ok: true, rows: [{ value: "A", label: "Alpha" }] });
  });

  it("rejects duplicates regardless of case", () => {
    const result = parseOptionRows("KL001\nkl001");
    expect(result).toEqual({ ok: false, error: 'Line 2: "kl001" appears more than once.' });
  });

  it("rejects empty input", () => {
    expect(parseOptionRows("value\n").ok).toBe(false);
  });
});

describe("parameter values", () => {
  const definitions: ParameterDefinition[] = [
    {
      id: "p-store",
      key: "store_code",
      name: "Store",
      fieldType: "dropdown",
      isRequired: true,
      isActive: true,
      options: [
        { id: "o-kl", value: "KL001", isActive: true },
        { id: "o-old", value: "OLD9", isActive: false },
      ],
    },
    { id: "p-note", key: "note", name: "Note", fieldType: "text", isRequired: false, isActive: true, options: [] },
    { id: "p-gone", key: "gone", name: "Gone", fieldType: "text", isRequired: true, isActive: false, options: [] },
  ];

  it("accepts valid values and stores dropdown values as defined", () => {
    expect(validateParameterValues(definitions, { store_code: "kl001", note: " shelf A " })).toEqual({
      ok: true,
      values: [
        { parameterId: "p-store", key: "store_code", value: "KL001", optionId: "o-kl" },
        { parameterId: "p-note", key: "note", value: "shelf A", optionId: null },
      ],
    });
  });

  it("allows optional values to be empty, and ignores inactive required parameters", () => {
    expect(validateParameterValues(definitions, { store_code: "KL001" }).ok).toBe(true);
  });

  it("enforces required parameters", () => {
    expect(validateParameterValues(definitions, { note: "x" })).toEqual({
      ok: false,
      errors: { store_code: "Store is required." },
    });
  });

  it("rejects unknown options, inactive options and unknown or inactive keys", () => {
    const result = validateParameterValues(definitions, { store_code: "OLD9", gone: "x", extra: "y" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(["extra", "gone", "store_code"]);
  });

  it("allows no parameters at all", () => {
    expect(validateParameterValues([], {})).toEqual({ ok: true, values: [] });
  });
});
