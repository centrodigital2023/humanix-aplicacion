import { defineConfig } from "vitest/config";
import path from "node:path";

// Standalone Vitest config — doesn't load the Lovable TanStack/Cloudflare
// plugin stack (which expects a browser/Worker build). jsdom + `@` alias.
export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});