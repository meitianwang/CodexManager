#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(appRoot, "..", "..");
const workflowPath = ".github/workflows/macos-desktop.yml";
const workflowName = "macOS Desktop";
const workflowFileName = "macos-desktop.yml";
const maxOutputBytes = 32 * 1024;
const jsonOutput = process.argv.includes("--json");
const offline = process.argv.includes("--offline");

const localWorkflowPath = join(repoRoot, workflowPath);
const localWorkflowExists = existsSync(localWorkflowPath);
const currentBranch = await commandText("git", ["branch", "--show-current"]);
const originURL = await commandText("git", ["remote", "get-url", "origin"]);
const remoteMain = offline ? undefined : await commandText("git", ["ls-remote", "--heads", "origin", "main"]);
const localWorkflowTracked = (await runCommand("git", ["ls-files", "--error-unmatch", workflowPath])).exitCode === 0;
const ghVersion = offline ? unavailableCommandResult("offline mode") : await runCommand("gh", ["--version"]);
const ghAuth = ghVersion.exitCode === 0 ? await runCommand("gh", ["auth", "status"]) : unavailableCommandResult("gh unavailable");

let workflowList = unavailableCommandResult();
let runList = unavailableCommandResult();
let remoteWorkflowFound = false;
let runs = [];

if (ghVersion.exitCode === 0 && ghAuth.exitCode === 0) {
  workflowList = await runCommand("gh", ["workflow", "list", "--all"]);
  remoteWorkflowFound = parseWorkflowList(workflowList.stdout).some((workflow) => workflow.name === workflowName);

  runList = await runCommand("gh", [
    "run",
    "list",
    "--workflow",
    workflowFileName,
    "--limit",
    "10",
    "--json",
    "databaseId,status,conclusion,createdAt,headBranch,headSha,displayTitle,url"
  ]);
  if (runList.exitCode === 0) {
    runs = parseRunList(runList.stdout);
  }
}

const successfulRuns = runs.filter((run) => run.status === "completed" && run.conclusion === "success");
const report = {
  status: successfulRuns.length > 0 ? "passed" : "pending",
  mode: "read-only-ci-evidence",
  offline,
  local: {
    currentBranch,
    originURL,
    remoteMain: parseRemoteHead(remoteMain),
    workflowExists: localWorkflowExists,
    workflowPath,
    workflowTracked: localWorkflowTracked
  },
  github: {
    ghAvailable: ghVersion.exitCode === 0,
    ghAuthenticated: ghAuth.exitCode === 0,
    remoteWorkflowFound,
    workflowName,
    latestRuns: runs.map(redactRun),
    latestSuccessfulRun: successfulRuns[0] ? redactRun(successfulRuns[0]) : undefined,
    workflowListError: workflowList.exitCode === 0 ? undefined : commandErrorSummary(workflowList),
    runListError: runList.exitCode === 0 ? undefined : commandErrorSummary(runList)
  },
  sideEffects: {
    mutatesRemote: false,
    dispatchesWorkflow: false,
    downloadsArtifacts: false
  }
};

printReport(report);

function parseWorkflowList(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, state, id] = line.split(/\t/);
      return { id, name, state };
    });
}

function parseRunList(stdout) {
  try {
    const value = JSON.parse(stdout);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function parseRemoteHead(stdout) {
  if (!stdout) {
    return undefined;
  }
  const [sha, ref] = stdout.trim().split(/\s+/);
  return sha && ref ? { sha, ref } : undefined;
}

function redactRun(run) {
  return {
    conclusion: run.conclusion,
    createdAt: run.createdAt,
    databaseId: run.databaseId,
    displayTitle: run.displayTitle,
    headBranch: run.headBranch,
    headSha: run.headSha,
    status: run.status,
    url: run.url
  };
}

async function commandText(command, args) {
  const result = await runCommand(command, args);
  return result.exitCode === 0 ? result.stdout.trim() : undefined;
}

function unavailableCommandResult(reason = "command was not run") {
  return {
    exitCode: 127,
    signal: null,
    stdout: "",
    stderr: reason
  };
}

function commandErrorSummary(result) {
  const text = (result.stderr || result.stdout).trim();
  return text.length > 0 ? text : `exit ${result.exitCode ?? result.signal ?? "unknown"}`;
}

function runCommand(command, args) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let settled = false;

    const settle = (result) => {
      if (settled) {
        return;
      }
      settled = true;
      resolveResult(result);
    };

    child.on("error", (error) => {
      settle({
        exitCode: 1,
        signal: null,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error)
      });
    });
    child.on("close", (exitCode, signal) => {
      settle({
        exitCode,
        signal,
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8")
      });
    });

    child.stdout.on("data", (chunk) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendBounded(stderr, chunk);
    });
  });
}

function appendBounded(previous, chunk) {
  const next = Buffer.concat([previous, Buffer.from(chunk)]);
  return next.byteLength <= maxOutputBytes ? next : next.subarray(next.byteLength - maxOutputBytes);
}

function printReport(value) {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  const lines = [
    "macOS CI evidence",
    "",
    `Status: ${value.status}`,
    `Local workflow exists: ${value.local.workflowExists ? "yes" : "no"}`,
    `Local workflow tracked: ${value.local.workflowTracked ? "yes" : "no"}`,
    `GitHub CLI available: ${value.github.ghAvailable ? "yes" : "no"}`,
    `GitHub authenticated: ${value.github.ghAuthenticated ? "yes" : "no"}`,
    `Remote workflow found: ${value.github.remoteWorkflowFound ? "yes" : "no"}`,
    `Latest successful run: ${value.github.latestSuccessfulRun?.url ?? "none"}`,
    "",
    "No workflow dispatch, artifact download, or remote mutation was performed."
  ];

  if (value.github.runListError) {
    lines.push("", `Run list note: ${value.github.runListError}`);
  }

  process.stdout.write(`${lines.join("\n")}\n`);
}
