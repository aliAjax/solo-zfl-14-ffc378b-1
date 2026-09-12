import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "happy-dom",
          globals: true,
          include: ["test/unit/**/*.test.js"]
        }
      },
      {
        extends: true,
        test: {
          name: "browser",
          environment: "node",
          globals: true,
          include: ["test/browser/**/*.spec.js"],
          testTimeout: 30000,
          hookTimeout: 60000
        }
      }
    ]
  }
});
