import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/workers/**"],
    environment: "node",
    setupFiles: ["./tests/setup.node.ts"],
  },
});
