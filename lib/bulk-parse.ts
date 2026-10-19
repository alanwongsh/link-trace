// Checks a bulk placement CSV against a workspace's parameters. Shared by the server action and
// tests; nothing here touches the database.
import { parseCsv } from "@/lib/csv";
import { validateParameterValues, type ParameterDefinition, type ParameterValue } from "@/lib/parameters";

export const MAX_BULK_ROWS = 1000;
export const NAME_COLUMN = "name";

export type BulkRow = { name: string | null; values: ParameterValue[] };
export type BulkProblem = { line: number; message: string };

export type BulkParseResult = {
  rows: BulkRow[];
  problems: BulkProblem[];
  // Header columns that were recognised, in file order.
  columns: string[];
};

// Line 1 is the header: "name" (optional) and parameter keys, in any order and case. Each later
// line becomes one placement. Only the rows given are created; no combinations are generated.
export function parseBulkCsv(definitions: ParameterDefinition[], text: string): BulkParseResult {
  const table = parseCsv(text);
  const result: BulkParseResult = { rows: [], problems: [], columns: [] };
  if (table.length === 0) {
    result.problems.push({ line: 1, message: "The file is empty. Line 1 must list the column names." });
    return result;
  }

  const header = table[0].map((cell) => cell.trim().toLowerCase());
  const active = new Set(definitions.filter((d) => d.isActive).map((d) => d.key));
  const seen = new Set<string>();
  for (const column of header) {
    if (!column) continue;
    if (seen.has(column)) result.problems.push({ line: 1, message: `The column ${column} appears twice.` });
    seen.add(column);
    if (column !== NAME_COLUMN && !active.has(column)) {
      result.problems.push({ line: 1, message: `${column} is not an active parameter in this workspace.` });
    }
  }
  result.columns = header.filter((column) => column);
  const missing = definitions.filter((d) => d.isActive && d.isRequired && !seen.has(d.key));
  for (const definition of missing) {
    result.problems.push({ line: 1, message: `The required column ${definition.key} (${definition.name}) is missing.` });
  }
  if (result.problems.length) return result;

  const body = table.slice(1);
  if (body.length === 0) {
    result.problems.push({ line: 2, message: "Add at least one row under the header." });
    return result;
  }
  if (body.length > MAX_BULK_ROWS) {
    result.problems.push({ line: MAX_BULK_ROWS + 2, message: `Upload up to ${MAX_BULK_ROWS} rows at a time.` });
    return result;
  }

  body.forEach((cells, index) => {
    const line = index + 2;
    if (cells.length > header.length) {
      result.problems.push({ line, message: `Has ${cells.length} columns; the header has ${header.length}.` });
      return;
    }
    const input: Record<string, string> = {};
    let name: string | null = null;
    header.forEach((column, i) => {
      const value = (cells[i] ?? "").trim();
      if (!column) return;
      if (column === NAME_COLUMN) name = value || null;
      else if (value) input[column] = value;
    });
    if (name !== null && (name as string).length > 80) {
      result.problems.push({ line, message: "The name is over 80 characters." });
      return;
    }
    const checked = validateParameterValues(definitions, input);
    if (!checked.ok) {
      for (const message of Object.values(checked.errors)) result.problems.push({ line, message });
      return;
    }
    result.rows.push({ name, values: checked.values });
  });
  return result;
}
