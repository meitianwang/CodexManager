#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const desktopRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const devRunnerPath = join(desktopRoot, "scripts/dev-runner.mjs");
const pidFile = join(desktopRoot, ".codexmanager-dev.pid");
const logFile = join(desktopRoot, "codexmanager-dev.log");
const termGraceMilliseconds = 3_000;
const commandBufferLimit = 8 * 1024;

await main();

async function main() {
  cleanupOldInstance();
  cleanupLegacyInstances();
  startDevRunner();
}

function log(message) {
  console.log(`[CodexManager dev] ${message}`);
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCommand(pid) {
  return runText("ps", ["-ww", "-p", String(pid), "-o", "command="]);
}

function runText(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      maxBuffer: commandBufferLimit
    }).trim();
  } catch {
    return "";
  }
}

function parsePIDs(text) {
  return text
    .split(/\s+/)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isInteger(value) && value > 0 && value !== process.pid);
}

function cleanupOldInstance() {
  const oldPID = readPIDFile();
  if (oldPID === undefined || !isManagedRoot(oldPID)) {
    rmSync(pidFile, { force: true });
    log("未发现旧的 CodexManager dev 进程");
    return;
  }

  const pids = [...descendantsOf(oldPID), oldPID];
  log(`清理旧的 CodexManager dev 进程: ${pids.join(" ")}`);
  terminatePIDs(pids);
  rmSync(pidFile, { force: true });
}

function readPIDFile() {
  let text = "";
  try {
    text = readFileSync(pidFile, "utf8");
  } catch {
    return undefined;
  }
  const pid = Number.parseInt(text.replace(/\D/g, ""), 10);
  return Number.isInteger(pid) ? pid : undefined;
}

function isManagedRoot(pid) {
  if (!processAlive(pid)) {
    return false;
  }
  const command = processCommand(pid);
  return command.includes(devRunnerPath) || command.includes("scripts/dev-runner.mjs");
}

function cleanupLegacyInstances() {
  const candidates = new Set();
  for (const pattern of legacyPatterns()) {
    for (const pid of parsePIDs(runText("pgrep", ["-f", pattern]))) {
      if (isManagedDevProcess(pid)) {
        descendantsOf(pid).forEach((childPID) => candidates.add(childPID));
        candidates.add(pid);
      }
    }
  }

  if (candidates.size === 0) {
    return;
  }

  const pids = [...candidates].sort((left, right) => left - right);
  log(`清理旧的 CodexManager dev 残留进程: ${pids.join(" ")}`);
  terminatePIDs(pids);
}

function legacyPatterns() {
  return [
    devRunnerPath,
    "scripts/dev-runner.mjs",
    `${desktopRoot}.*vite/bin/vite.js.*--host 127.0.0.1`,
    `${desktopRoot}.*Electron.app/Contents/MacOS/Electron`,
    "pnpm.*run dev",
    "concurrently.*vite --host 127.0.0.1",
    "VITE_DEV_SERVER_URL=http://127.0.0.1:5173"
  ];
}

function isManagedDevProcess(pid) {
  if (!processAlive(pid)) {
    return false;
  }
  const command = processCommand(pid);
  if (!command.includes(desktopRoot) && !command.includes("scripts/dev-runner.mjs")) {
    return false;
  }
  return (
    command.includes("scripts/dev-runner.mjs") ||
    command.includes("pnpm run dev") ||
    command.includes("concurrently") ||
    command.includes("vite/bin/vite.js") ||
    command.includes("VITE_DEV_SERVER_URL=http://127.0.0.1:5173") ||
    command.includes("Electron.app/Contents/MacOS/Electron")
  );
}

function descendantsOf(pid) {
  const result = [];
  for (const childPID of parsePIDs(runText("pgrep", ["-P", String(pid)]))) {
    result.push(...descendantsOf(childPID));
    result.push(childPID);
  }
  return result;
}

function terminatePIDs(pids) {
  if (pids.length === 0) {
    return;
  }

  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }

  const deadline = Date.now() + termGraceMilliseconds;
  while (Date.now() < deadline && pids.some((pid) => processAlive(pid))) {
    sleep(100);
  }

  for (const pid of pids) {
    if (!processAlive(pid)) {
      continue;
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function startDevRunner() {
  const logFD = openSync(logFile, "a");
  try {
    const child = spawn(process.execPath, [devRunnerPath], {
      cwd: desktopRoot,
      detached: true,
      stdio: ["ignore", logFD, logFD]
    });
    child.unref();
    writeFileSync(pidFile, `${child.pid}\n`);
    log(`启动 Electron dev app: PID ${child.pid}`);
    log(`日志: ${logFile}`);
  } finally {
    closeSync(logFD);
  }

  sleep(500);
  const startedPID = readPIDFile();
  if (startedPID === undefined || !processAlive(startedPID)) {
    log("启动失败，最近日志如下:");
    console.log(readLogTail());
    process.exit(1);
  }
}

function readLogTail() {
  let fd;
  try {
    const stats = statSync(logFile);
    const length = Math.min(stats.size, commandBufferLimit);
    const buffer = Buffer.alloc(length);
    fd = openSync(logFile, "r");
    readSync(fd, buffer, 0, length, stats.size - length);
    return buffer.toString("utf8").trimEnd();
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      closeSync(fd);
    }
  }
}
