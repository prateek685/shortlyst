import {
  InvalidRoleRequirementsError,
  validateRoleRequirements,
} from "./validate";
import type { RoleRequirements } from "./types";

function baseRole(overrides: Partial<RoleRequirements> = {}): RoleRequirements {
  return {
    roleId: "test-role",
    dimensions: [
      { id: "a", instructions: "...", weight: 0.5, levels: ["low", "high"] },
      { id: "b", instructions: "...", weight: 0.5, levels: ["low", "high"] },
    ],
    mustHaves: [],
    thresholds: { contact: 0.65, reject: 0.35, confidenceFloor: 0.5 },
    ...overrides,
  };
}

describe("validateRoleRequirements", () => {
  it("accepts a well-formed role", () => {
    expect(() => validateRoleRequirements(baseRole())).not.toThrow();
  });

  it("rejects weights that don't sum to ~1.0", () => {
    const role = baseRole({
      dimensions: [
        { id: "a", instructions: "...", weight: 0.5, levels: ["low", "high"] },
        { id: "b", instructions: "...", weight: 0.2, levels: ["low", "high"] },
      ],
    });
    expect(() => validateRoleRequirements(role)).toThrow(
      InvalidRoleRequirementsError,
    );
  });

  it("accepts weights within floating-point tolerance of 1.0", () => {
    const role = baseRole({
      dimensions: [
        { id: "a", instructions: "...", weight: 0.1, levels: ["low", "high"] },
        { id: "b", instructions: "...", weight: 0.2, levels: ["low", "high"] },
        { id: "c", instructions: "...", weight: 0.7, levels: ["low", "high"] },
      ],
    });
    expect(() => validateRoleRequirements(role)).not.toThrow();
  });

  it("rejects a dimension with fewer than 2 levels", () => {
    const role = baseRole({
      dimensions: [
        { id: "a", instructions: "...", weight: 1, levels: ["only-one"] },
      ],
    });
    expect(() => validateRoleRequirements(role)).toThrow(
      InvalidRoleRequirementsError,
    );
  });

  it("rejects an empty dimensions list", () => {
    const role = baseRole({ dimensions: [] });
    expect(() => validateRoleRequirements(role)).toThrow(
      InvalidRoleRequirementsError,
    );
  });

  it("rejects thresholds.reject greater than thresholds.contact", () => {
    const role = baseRole({
      thresholds: { contact: 0.4, reject: 0.6, confidenceFloor: 0.5 },
    });
    expect(() => validateRoleRequirements(role)).toThrow(
      InvalidRoleRequirementsError,
    );
  });
});
