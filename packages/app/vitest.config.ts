import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["server/__tests__/setup.ts", "src/__tests__/setup.ts"],
  },
});
