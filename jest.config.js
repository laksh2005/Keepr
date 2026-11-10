module.exports = {
  moduleFileExtensions: ["js", "json", "ts"],
  rootDir: ".",
  testRegex: ".*\\.spec\\.ts$",
  transform: { "^.+\\.(t|j)s$": ["ts-jest", { tsconfig: "tsconfig.json" }] },
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts"],
  coverageDirectory: "coverage",
  testEnvironment: "node",
  // The downloaded embedding model is ~100MB of binaries, nothing for Jest to crawl.
  modulePathIgnorePatterns: ["<rootDir>/models/"],
  setupFiles: ["<rootDir>/test/setup-no-network.ts"]
};
