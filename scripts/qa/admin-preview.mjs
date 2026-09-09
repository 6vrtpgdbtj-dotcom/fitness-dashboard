// Local-only visual harness. Uses actual components and fictional fixtures;
// network mutations are intercepted in the fixture, never sent to Supabase.
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const runtime = createRequire(require.resolve("vitest/package.json"));
const { createServer } = await import(pathToFileURL(runtime.resolve("vite")).href);
const server = await createServer({
  configFile: false,
  root: resolve("scripts/qa/admin-preview"),
  publicDir: resolve("public"),
  resolve: { alias: [
    { find: "next/navigation", replacement: resolve("scripts/qa/admin-preview/navigation.ts") },
    { find: "@/features/mapping/save-mapping-version", replacement: resolve("scripts/qa/admin-preview/mapping.ts") },
    { find: "@", replacement: resolve("src") },
  ] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 3018, strictPort: true, fs: { allow: [resolve(".")] } },
});
await server.listen(); server.printUrls();
