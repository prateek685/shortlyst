import type { RoleRequirements } from "./types";

const WEIGHT_SUM_TOLERANCE = 0.01;

export class InvalidRoleRequirementsError extends Error {}

export function validateRoleRequirements(role: RoleRequirements): void {
  if (!role.roleId) {
    throw new InvalidRoleRequirementsError("roleId is required");
  }
  if (role.dimensions.length === 0) {
    throw new InvalidRoleRequirementsError("at least one dimension is required");
  }

  const weightSum = role.dimensions.reduce((sum, d) => sum + d.weight, 0);
  if (Math.abs(weightSum - 1) > WEIGHT_SUM_TOLERANCE) {
    throw new InvalidRoleRequirementsError(
      `dimension weights must sum to ~1.0, got ${weightSum.toFixed(3)}`,
    );
  }

  for (const dimension of role.dimensions) {
    if (dimension.levels.length < 2 || dimension.levels.length > 10) {
      throw new InvalidRoleRequirementsError(
        `dimension "${dimension.id}" must have 2-10 levels, got ${dimension.levels.length}`,
      );
    }
  }

  const { contact, reject, confidenceFloor } = role.thresholds;
  if (!(reject <= contact)) {
    throw new InvalidRoleRequirementsError("thresholds.reject must be <= thresholds.contact");
  }
  if (confidenceFloor < 0 || confidenceFloor > 1) {
    throw new InvalidRoleRequirementsError("thresholds.confidenceFloor must be between 0 and 1");
  }
}
