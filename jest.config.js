/** @type {import('jest').Config} */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
};

module.exports = {
  projects: [
    {
      ...base,
      displayName: "unit",
      testMatch: ["<rootDir>/src/**/*.spec.ts"],
    },
    {
      ...base,
      displayName: "e2e",
      testMatch: ["<rootDir>/tests/e2e/**/*.e2e-spec.ts"],
    },
  ],
};
