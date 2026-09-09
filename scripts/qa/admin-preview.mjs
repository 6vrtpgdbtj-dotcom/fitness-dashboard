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
  plugins:[{name:"local-mapping-preview",configureServer(server){server.middlewares.use("/__qa_mapping_preview",async(req,res,next)=>{
    if(req.method!=="POST") return next();
    try {
      const chunks=[];for await(const chunk of req) chunks.push(chunk);
      const input=JSON.parse(Buffer.concat(chunks).toString());
      const {mapColumns}=await server.ssrLoadModule(resolve("src/features/mapping/map-columns.ts"));
      const {rows}=await server.ssrLoadModule(resolve("scripts/qa/admin-preview/rows.ts"));
      const result=mapColumns({organizationId:"fixture",sourceConnectionId:"fictional-sheet",sourceTabId:input.sourceTabId,tabTitle:"가상 원본",domain:input.domain,headerRowIndex:input.headerRowIndex,rows});
      res.setHeader("Content-Type","application/json");res.end(JSON.stringify(result));
    }catch{res.statusCode=500;res.end("Preview failed");}
  });}}],
  root: resolve("scripts/qa/admin-preview"),
  publicDir: resolve("public"),
  resolve: { alias: [
    { find: "next/navigation", replacement: resolve("scripts/qa/admin-preview/navigation.ts") },
    { find: "@/features/mapping/save-mapping-version", replacement: resolve("scripts/qa/admin-preview/mapping.ts") },
    { find: "@/features/admin/preview-mapping", replacement: resolve("scripts/qa/admin-preview/preview.ts") },
    { find: "@", replacement: resolve("src") },
  ] },
  esbuild: { jsx: "automatic" },
  server: { host: "127.0.0.1", port: 3018, strictPort: true, fs: { allow: [resolve(".")] } },
});
await server.listen(); server.printUrls();
