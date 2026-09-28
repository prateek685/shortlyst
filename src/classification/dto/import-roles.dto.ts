import { IsArray } from "class-validator";

// Raw values exactly as the Sheets API returns them for a range — validated
// loosely (just "is an array") since the real structure-checking happens in
// parseRolesFromSheetRows/validateRoleRequirements, which give roleId-
// specific, actionable errors rather than a generic 400.
export class ImportRolesDto {
  @IsArray()
  dimensionRows!: string[][];

  @IsArray()
  mustHaveRows!: string[][];

  @IsArray()
  thresholdRows!: string[][];
}
