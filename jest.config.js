"use strict";

module.exports = {
    collectCoverageFrom: ["src/**/*.js"],
    coverageDirectory: "coverage",
    coverageReporters: ["text", "lcov", "json-summary"],
    coverageThreshold: {
        global: {
            statements: 90,
            branches: 85,
            functions: 90,
            lines: 90
        }
    }
};
