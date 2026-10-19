import { describe, expect, it } from "vitest";
import {
  combinationCount,
  normalizeKey,
  parseOptionRows,
  parseParameterFields,
  planPlacements,
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

  it("treats every parameter as optional, even ones stored as required", () => {
    expect(validateParameterValues(definitions, { note: "x" })).toEqual({
      ok: true,
      values: [{ parameterId: "p-note", key: "note", value: "x", optionId: null }],
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

describe("planning labelled links from picked values", () => {
  const option = (value: string) => ({ id: `o-${value}`, value, isActive: true });
  const definitions: ParameterDefinition[] = [
    { id: "p-store", key: "store", name: "Store", fieldType: "dropdown", isRequired: true, isActive: true, options: ["A", "B", "C"].map(option) },
    { id: "p-channel", key: "channel", name: "Channel", fieldType: "dropdown", isRequired: false, isActive: true, options: ["email", "lark"].map(option) },
    { id: "p-note", key: "note", name: "Note", fieldType: "text", isRequired: false, isActive: true, options: [] },
  ];
  const rowsOf = (result: ReturnType<typeof planPlacements>) =>
    result.ok ? result.rows.map((row) => row.map((v) => v.value).join(" · ")) : result.errors;

  it("makes every combination, in label order, with single values applied to all", () => {
    const result = planPlacements(definitions, { channel: ["email", "lark"], store: ["a", "B"], note: ["x"] }, 100);
    expect(rowsOf(result)).toEqual(["A · email · x", "A · lark · x", "B · email · x", "B · lark · x"]);
    expect(combinationCount({ channel: ["email", "lark"], store: ["A", "B"], note: ["x"], empty: [] })).toBe(4);
  });

  it("refuses more than the limit before checking any value", () => {
    const result = planPlacements(definitions, { store: ["A", "B", "C"], channel: ["email", "lark"] }, 5);
    expect(result).toEqual({ ok: false, errors: { store: "That makes 6 labelled links; the limit is 5 at a time." } });
  });

  it("names the label with a bad value, and needs no label in particular", () => {
    expect(rowsOf(planPlacements(definitions, { store: ["A", "ZZ"] }, 100))).toEqual({ store: '"ZZ" is not an option for Store.' });
    expect(rowsOf(planPlacements(definitions, { channel: ["email", "lark"] }, 100))).toEqual(["email", "lark"]);
  });
});
