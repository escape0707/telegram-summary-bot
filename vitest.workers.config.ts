import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    include: ["src/**/*.worker.test.ts"],
    poolOptions: {
      workers: {
        main: "./src/index.ts",
        miniflare: {
          compatibilityDate: "2026-02-03",
          d1Databases: ["DB"],
        },
        isolatedStorage: true,
      },
    },
  },
});
