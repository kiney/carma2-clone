import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parsePort } from "../server/startup.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tempRoots = [];
const processExits = new WeakMap();

function observeExit(child) {
  let exit = processExits.get(child);
  if (!exit) {
    exit = new Promise((resolve) => {
      child.once("error", (error) => resolve({ error }));
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    processExits.set(child, exit);
  }
  return exit;
}

async function emptyAssetRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "carma-startup-test-"));
  tempRoots.push(root);
  return root;
}

async function availablePort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise((resolve, reject) =>
    listener.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

function launch({ port, root, production = true }) {
  const child = spawn(
    process.execPath,
    ["server/dev.mjs", ...(production ? ["--production"] : [])],
    {
      cwd: repo,
      env: { ...process.env, PORT: String(port), CARMA2_ROOT: root },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  observeExit(child);
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  child.stderr.setEncoding("utf8").on("data", (chunk) => (output += chunk));
  return {
    child,
    get output() {
      return output;
    },
  };
}

function waitForExit(child, timeoutMs = 5000, readOutput = () => "") {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(
        new Error(
          `Child process did not exit within ${timeoutMs} ms: ${readOutput()}`,
        ),
      );
    }, timeoutMs);
    observeExit(child).then((exit) => {
      clearTimeout(timeout);
      if (exit.error) reject(exit.error);
      else resolve(exit);
    });
  });
}

async function waitForOutput(child, readOutput, expected, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (readOutput().includes(expected)) return;
    if (child.exitCode !== null)
      throw new Error(
        `Process exited before producing ${JSON.stringify(expected)}: ${readOutput()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Process did not produce ${JSON.stringify(expected)}: ${readOutput()}`,
  );
}

function openHmrSocket(port) {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1");
    let response = "";
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.setTimeout(3000, () =>
      fail(new Error("Vite HMR handshake timed out")),
    );
    socket.once("error", fail);
    socket.once("connect", () => {
      const key = randomBytes(16).toString("base64");
      socket.write(
        [
          "GET / HTTP/1.1",
          `Host: 127.0.0.1:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Protocol: vite-hmr",
          "\r\n",
        ].join("\r\n"),
      );
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("latin1");
      const end = response.indexOf("\r\n\r\n");
      if (end < 0) return;
      const status = response.slice(0, end);
      if (!/^HTTP\/1\.1 101\b/.test(status)) {
        fail(new Error(`Vite HMR upgrade failed: ${status}`));
        return;
      }
      socket.setTimeout(0);
      resolve(socket);
    });
    socket.once("close", () => {
      if (!response.includes("\r\n\r\n"))
        reject(
          new Error("Vite HMR socket closed before its handshake completed"),
        );
    });
  });
}

test.after(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("PORT parser defaults only when unset and accepts only TCP port integers", () => {
  assert.equal(parsePort(undefined), 5173);
  assert.equal(parsePort("1"), 1);
  assert.equal(parsePort("65535"), 65535);
  for (const value of ["", "0", "-1", "1.5", "70000", "abc"]) {
    assert.throws(parsePort.bind(null, value), /integer from 1 to 65535/);
  }
});

test("waitForExit observes a child that closes before the caller starts waiting", async () => {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
  });
  const observed = observeExit(child);
  await observed;

  assert.deepEqual(await waitForExit(child, 100), { code: 0, signal: null });
});

test("occupied port reports a clear startup error and exits unsuccessfully", async () => {
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const { port } = occupied.address();
  const launched = launch({ port, root: await emptyAssetRoot() });
  const { child } = launched;
  try {
    const exit = await waitForExit(child);
    assert.equal(exit.code, 1, launched.output);
    assert.match(launched.output, new RegExp(`Port ${port} is already in use`));
    assert.match(launched.output, /set PORT to an available port/i);
    assert.doesNotMatch(launched.output, /EADDRINUSE.*stack|node:net/);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("development startup releases Vite resources when its HTTP port is occupied", async () => {
  const occupied = createServer();
  await new Promise((resolve, reject) => {
    occupied.once("error", reject);
    occupied.listen(0, "127.0.0.1", resolve);
  });
  const { port } = occupied.address();
  const launched = launch({
    port,
    root: await emptyAssetRoot(),
    production: false,
  });
  try {
    const exit = await waitForExit(launched.child);
    assert.equal(exit.code, 1, launched.output);
    assert.match(launched.output, new RegExp(`Port ${port} is already in use`));
    assert.match(launched.output, /set PORT to an available port/i);
    assert.doesNotMatch(launched.output, /node:net|EADDRINUSE.*stack/);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test("invalid PORT values are rejected with the accepted range before startup", async () => {
  for (const port of ["70000", ""]) {
    const launched = launch({ port, root: await emptyAssetRoot() });
    const exit = await waitForExit(launched.child);
    assert.equal(exit.code, 1, launched.output);
    assert.match(launched.output, new RegExp(`Invalid PORT value "${port}"`));
    assert.match(launched.output, /integer from 1 to 65535/);
  }
});

test("asset indexing failure names the configured root and exits unsuccessfully", async () => {
  const absentRoot = path.join(await emptyAssetRoot(), "missing-install");
  const launched = launch({ port: await availablePort(), root: absentRoot });
  const { child } = launched;
  const exit = await waitForExit(child);
  assert.equal(exit.code, 1, launched.output);
  assert.match(launched.output, /Could not index local assets/);
  assert.match(launched.output, /CARMA2_ROOT/);
});

test("server starts normally, serves the asset manifest, and closes on SIGTERM", async () => {
  const port = await availablePort();
  const launched = launch({ port, root: await emptyAssetRoot() });
  const { child } = launched;
  try {
    await waitForOutput(
      child,
      () => launched.output,
      `http://localhost:${port}`,
    );
    const response = await fetch(`http://127.0.0.1:${port}/api/manifest`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      assets: [],
      rootName: path.basename(tempRoots.at(-1)),
    });
    child.kill("SIGTERM");
    const exit = await waitForExit(child);
    assert.equal(exit.code, 0, launched.output);

    const rebound = createServer();
    await new Promise((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve, reject) =>
      rebound.close((error) => (error ? reject(error) : resolve())),
    );
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child).catch(() => {});
    }
  }
});

test("development server closes Vite before waiting on its open HMR socket", async () => {
  const port = await availablePort();
  const launched = launch({
    port,
    root: await emptyAssetRoot(),
    production: false,
  });
  const { child } = launched;
  let socket;
  try {
    await waitForOutput(
      child,
      () => launched.output,
      `http://localhost:${port}`,
    );
    const client = await fetch(`http://127.0.0.1:${port}/@vite/client`);
    assert.equal(client.status, 200);
    assert.match(await client.text(), /WebSocket/);
    socket = await openHmrSocket(port);

    child.kill("SIGTERM");
    const exit = await waitForExit(child, 15000, () => launched.output);
    assert.equal(exit.code, 0, launched.output);
    assert.match(launched.output, /local assets/);

    const rebound = createServer();
    await new Promise((resolve, reject) => {
      rebound.once("error", reject);
      rebound.listen(port, "127.0.0.1", resolve);
    });
    await new Promise((resolve, reject) =>
      rebound.close((error) => (error ? reject(error) : resolve())),
    );
  } finally {
    socket?.destroy();
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await waitForExit(child).catch(() => {});
    }
  }
});
