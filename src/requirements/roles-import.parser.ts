import type { RoleRequirements } from "./types";

// Turns a sheet's [header, ...rows] into objects keyed by the header cells,
// trimmed. Blank rows (e.g. a trailing empty row) are dropped.
function rowsToObjects(rows: string[][]): Record<string, string>[] {
  const [header, ...body] = rows;
  if (!header) return [];
  const keys = header.map((cell) => cell.trim());
  return body
    .filter((row) => row.some((cell) => cell?.trim()))
    .map((row) => Object.fromEntries(keys.map((key, i) => [key, (row[i] ?? "").trim()])));
}

const LEVEL_COLUMNS = ["level_1", "level_2", "level_3", "level_4", "level_5", "level_6"];

// Pure mapping from a roles sheet's three tabs (raw values, as returned by
// the Sheets API) to RoleRequirements — the rows are fetched client-side by
// the extension (via the user's own Google sign-in) and POSTed here; this
// function doesn't know or care where they came from. Intentionally
// unvalidated — roles.service.ts owns validation so it can give
// roleId-specific, actionable error messages rather than this silently
// dropping something malformed.
export function parseRolesFromSheetRows(
  dimensionRows: string[][],
  mustHaveRows: string[][],
  thresholdRows: string[][],
): RoleRequirements[] {
  const dimensionsByRole = rowsToObjects(dimensionRows);
  const mustHavesByRole = rowsToObjects(mustHaveRows);
  const thresholdsByRole = rowsToObjects(thresholdRows);

  const roleIds = [...new Set(dimensionsByRole.map((d) => d.role_id).filter(Boolean))];

  return roleIds.map((roleId) => {
    const thresholdRow = thresholdsByRole.find((t) => t.role_id === roleId);
    return {
      roleId,
      dimensions: dimensionsByRole
        .filter((d) => d.role_id === roleId)
        .map((d) => ({
          id: d.dimension_id,
          instructions: d.instructions,
          weight: Number(d.weight),
          levels: LEVEL_COLUMNS.map((col) => d[col]).filter((level): level is string => Boolean(level)),
        })),
      mustHaves: mustHavesByRole
        .filter((m) => m.role_id === roleId)
        .map((m) => ({ id: m.must_have_id, instructions: m.instructions })),
      thresholds: {
        contact: Number(thresholdRow?.contact_threshold),
        reject: Number(thresholdRow?.reject_threshold),
        confidenceFloor: Number(thresholdRow?.confidence_floor),
      },
    };
  });
}
