// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";
import path from "path";

export default defineConfig({
  vite: ({ mode }: { mode: string }) => {
    // Server routes (e.g. /lovable/email/*) need non-VITE_ env vars such as
    // LOVABLE_API_KEY in process.env. Client code keeps using VITE_* only.
    const serverEnv = loadEnv(mode, process.cwd(), "");
    Object.assign(process.env, serverEnv);

    return {
      resolve: {
        alias: {
          // Pin entities to the hoisted v4.5.0 copy; nested v7 breaks SSR.
          "entities/lib/decode.js": path.resolve(__dirname, "node_modules/entities/lib/decode.js"),
          "entities/lib/encode.js": path.resolve(__dirname, "node_modules/entities/lib/encode.js"),
          "entities": path.resolve(__dirname, "node_modules/entities"),
        },
      },
    };
  },
});
