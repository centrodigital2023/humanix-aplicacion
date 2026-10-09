// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import path from "path";

// Server routes (e.g. /lovable/email/*) need non-VITE_ env vars such as
// LOVABLE_API_KEY in process.env. Client code keeps using VITE_* only.
const serverEnv = loadEnv(process.env.NODE_ENV ?? "development", process.cwd(), "");
Object.assign(process.env, serverEnv);

const rootDir = import.meta.dirname;

export default defineConfig({
  vite: {
    resolve: {
      alias: {
        // Pin entities to the hoisted v4.5.0 copy; nested v7 breaks SSR.
        "entities/lib/decode.js": path.resolve(rootDir, "node_modules/entities/lib/decode.js"),
        "entities/lib/encode.js": path.resolve(rootDir, "node_modules/entities/lib/encode.js"),
        "entities": path.resolve(rootDir, "node_modules/entities"),
      },
    },
  },
});
