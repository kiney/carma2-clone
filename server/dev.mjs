import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { createAssetStore } from "./assets.mjs";
const root = path.resolve(process.env.CARMA2_ROOT || "carma2_orig");
const assets = await createAssetStore(root);
const production = process.argv.includes("--production");
let vite;
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/api/manifest") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          assets: assets.manifest,
          rootName: path.basename(root),
        }),
      );
      return;
    }
    if (url.pathname.startsWith("/api/asset/")) {
      const key = decodeURIComponent(url.pathname.slice(11));
      const data = await assets.read(key);
      if (!data) {
        res.writeHead(404);
        res.end("Asset not found");
        return;
      }
      res.setHeader(
        "Content-Type",
        key.toLowerCase().endsWith(".wav")
          ? "audio/wav"
          : "application/octet-stream",
      );
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(data);
      return;
    }
    if (vite) {
      vite.middlewares(req, res);
      return;
    }
    const relative =
      decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const target = path.resolve("dist", relative);
    const dist = path.resolve("dist");
    if (!target.startsWith(dist + path.sep) && target !== dist) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    let file = target;
    try {
      await fs.access(file);
    } catch {
      file = path.join(dist, "index.html");
    }
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.end(await fs.readFile(file));
  } catch (error) {
    res.writeHead(error.code === "ENOENT" ? 404 : 400);
    res.end(error.message);
  }
});
if (!production)
  vite = await (
    await import("vite")
  ).createServer({
    server: {
      host: "127.0.0.1",
      middlewareMode: true,
      hmr: { server },
      fs: {
        allow: [process.cwd()],
        deny: ["**/.env*", "**/.git/**", "**/carma2_orig/**"],
      },
    },
    appType: "spa",
  });
const port = Number(process.env.PORT || 5173);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `C2 browser: http://localhost:${port} | ${assets.manifest.length} local assets | ${root}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close();
    vite?.close();
  });
