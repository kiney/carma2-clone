import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { createAssetStore } from "./assets.mjs";
import { formatStartupError, parsePort } from "./startup.mjs";

const root = path.resolve(process.env.CARMA2_ROOT || "carma2_orig");
const production = process.argv.includes("--production");
let assets;
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

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

async function closeServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function closeVite(vite) {
  if (vite) await vite.close();
}

async function main() {
  const port = parsePort(process.env.PORT);
  try {
    assets = await createAssetStore(root);
  } catch (error) {
    throw new Error(
      `Could not index local assets at ${root}: ${error.message}. Check that CARMA2_ROOT points to an accessible directory.`,
      { cause: error },
    );
  }

  if (!production) {
    try {
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
    } catch (error) {
      throw new Error(
        `Could not start the Vite development server: ${error.message}`,
        {
          cause: error,
        },
      );
    }
  }

  try {
    await listen(server, port);
  } catch (error) {
    throw new Error(formatStartupError(error, port), { cause: error });
  }

  console.log(
    `C2 browser: http://localhost:${port} | ${assets.manifest.length} local assets | ${root}`,
  );

  let shuttingDown = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      void (async () => {
        try {
          await closeVite(vite);
        } catch (error) {
          console.error(
            `Could not close the Vite development server cleanly: ${error.message}`,
          );
          process.exitCode = 1;
        }
        try {
          await closeServer(server);
        } catch (error) {
          console.error(
            `Could not close the HTTP server cleanly: ${error.message}`,
          );
          process.exitCode = 1;
        }
      })();
    });
  }
}

try {
  await main();
} catch (error) {
  console.error(`Startup failed: ${error.message}`);
  try {
    await closeVite(vite);
  } catch (closeError) {
    console.error(
      `Could not close the Vite development server after startup failure: ${closeError.message}`,
    );
  }
  try {
    await closeServer(server);
  } catch (closeError) {
    console.error(
      `Could not close the HTTP server after startup failure: ${closeError.message}`,
    );
  }
  process.exitCode = 1;
}
