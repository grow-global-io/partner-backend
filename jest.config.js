module.exports = {
  testEnvironment: "node",
  clearMocks: true,
  collectCoverageFrom: [
    "src/**/*.js",
    "!src/**/*.test.js",
    "!src/**/__mocks__/**",
  ],
  coverageDirectory: "coverage",
  coverageReporters: ["text", "lcov", "html"],
  testMatch: ["**/__tests__/**/*.js", "**/?(*.)+(spec|test).js"],
  modulePathIgnorePatterns: ["<rootDir>/node_modules/", "<rootDir>/coverage/"],
  setupFilesAfterEnv: [],
  // Transform node_modules if needed
  transformIgnorePatterns: ["node_modules/(?!(.*\\.mjs$))"],
  // Verbose output for better debugging
  verbose: true,
};
