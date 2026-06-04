#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const host = "127.0.0.1";
const port = 5173;
const devServerUrl = `http://${host}:${port}`;
const termGraceMilliseconds = 3_000;
const viteEntrypoint = join(desktopRoot, "node_modules/vite/bin/vite.js");
const tscEntrypoint = join(desktopRoot, "node_modules/typescript/bin/tsc");
const electronExecutable = require("electron");
const children = new Set();
let shuttingDown = false;

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

void main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : String(error));
  await terminateChildren("SIGTERM");
  process.exit(1);
});

async function main() {
  await runOnce("main build", process.execPath, [tscEntrypoint, "-p", "tsconfig.main.json"]);

  const vite = startChild("vite", process.execPath, [viteEntrypoint, "--host", host]);
  try {
    await waitForPort(host, port, 30_000);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await terminateChildren("SIGTERM");
    process.exit(1);
  }

  const electron = startChild("electron", electronExecutable, ["."], {
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl
    }
  });

  const result = await Promise.race([waitForClose(vite, "vite"), waitForClose(electron, "electron")]);
  if (result.name === "electron") {
    await terminateChild(vite, "SIGTERM");
  }
  if (result.name === "vite") {
    await terminateChild(electron, "SIGTERM");
  }
  process.exit(exitCodeFrom(result));
}

function startChild(name, command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: desktopRoot,
    stdio: "inherit",
    ...options
  });
  children.add(child);
  child.once("close", () => {
    children.delete(child);
  });
  child.once("error", (error) => {
    console.error(`[${name}] failed to start: ${error.message}`);
  });
  return child;
}

function runOnce(name, command, args) {
  const child = startChild(name, command, args);
  return waitForClose(child, name).then((result) => {
    if (result.code === 0) {
      return;
    }
    process.exit(exitCodeFrom(result));
  });
}

function waitForClose(child, name) {
  return new Promise((resolve) => {
    child.once("close", (code, signal) => {
      resolve({ name, code, signal });
    });
  });
}

function waitForPort(waitHost, waitPort, timeoutMilliseconds) {
  const deadline = Date.now() + timeoutMilliseconds;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: waitHost, port: waitPort });
      let settled = false;

      socket.setTimeout(1_000);
      socket.once("connect", () => {
        settled = true;
        socket.end();
        resolve();
      });

      const retry = () => {
        if (settled) {
          return;
        }
        settled = true;
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(new Error(`Timed out waiting for ${waitHost}:${waitPort}`));
          return;
        }
        setTimeout(tryConnect, 100);
      };

      socket.once("error", retry);
      socket.once("timeout", retry);
    };

    tryConnect();
  });
}

async function terminateChildren(signal) {
  await Promise.all(Array.from(children, (child) => terminateChild(child, signal)));
}

async function terminateChild(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  child.kill(signal);
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, termGraceMilliseconds);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function exitCodeFrom(result) {
  if (result.code !== null && result.code !== undefined) {
    return result.code;
  }
  return result.signal ? 1 : 0;
}

async function shutdown(signal) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  await terminateChildren(signal);
  process.exit(signal === "SIGINT" ? 130 : 143);
}
