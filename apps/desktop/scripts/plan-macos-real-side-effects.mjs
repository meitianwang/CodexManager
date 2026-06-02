#!/usr/bin/env node

const approvalEnvName = "CODEX_MANAGER_ALLOW_REAL_MACOS_SIDE_EFFECTS";
const approvalEnvValue = "1";
const jsonOutput = process.argv.includes("--json");

const plannedChecks = [
  {
    id: "oauth-browser-login",
    requirement: "Verify real ChatGPT OAuth browser login through the Electron macOS app.",
    approvalRequired: true,
    sideEffectsIfExecuted: [
      "opens the user's default browser",
      "writes a temporary account-store backup file for recovery evidence",
      "writes OAuth token data into the CodexManager account store",
      "updates the CodexManager account list"
    ],
    evidenceToCapture: [
      "account store backup path before the run",
      "account was imported from the OAuth callback",
      "new account appears in the Electron account list",
      "no secrets are copied into logs or docs"
    ]
  },
  {
    id: "codex-launch",
    requirement: "Verify real Codex app or CLI launch after switching accounts.",
    approvalRequired: true,
    sideEffectsIfExecuted: [
      "terminates existing Codex desktop processes before relaunch",
      "launches Codex.app or the Codex CLI detached process",
      "passes the selected workspace path when configured"
    ],
    evidenceToCapture: [
      "Codex opens successfully",
      "the selected workspace path is honored where applicable",
      "fallback from app launch to CLI launch is documented if used"
    ]
  },
  {
    id: "editor-restart",
    requirement: "Verify real restart behavior for installed editor targets.",
    approvalRequired: true,
    sideEffectsIfExecuted: [
      "terminates selected editor processes",
      "reopens selected editor app bundles"
    ],
    evidenceToCapture: [
      "selected installed editor IDs are listed before the run",
      "each selected editor reopens",
      "any unsupported or missing editor target is recorded"
    ]
  },
  {
    id: "login-item",
    requirement: "Verify real launch-at-startup/login-item behavior on macOS.",
    approvalRequired: true,
    sideEffectsIfExecuted: [
      "reads macOS login-item state",
      "writes macOS login-item state through Electron app APIs"
    ],
    evidenceToCapture: [
      "initial login-item state",
      "enabled state after turning the setting on",
      "restored state after turning the setting back off or to the user's original value"
    ]
  },
  {
    id: "settings-write",
    requirement: "Verify real settings persistence against the user's CodexManager app data.",
    approvalRequired: true,
    sideEffectsIfExecuted: [
      "writes a temporary settings backup file for recovery evidence",
      "writes ~/Library/Application Support/CodexManager/settings.json",
      "may migrate legacy settings from accounts.json into settings.json"
    ],
    evidenceToCapture: [
      "settings file backup path before the run",
      "changed setting value after save and app restart",
      "restoration result for the user's original setting value"
    ]
  }
];

const report = {
  status: "planned",
  platform: process.platform,
  executionMode: "dry-run-plan",
  approvalGate: {
    required: true,
    env: approvalEnvName,
    acceptedValue: approvalEnvValue,
    currentlySet: process.env[approvalEnvName] === approvalEnvValue,
    note:
      "This script documents the required real macOS side-effect checks. It never performs them."
  },
  prerequisiteCommands: [
    "pnpm run verify:macos-real-data",
    "pnpm run smoke:macos-package"
  ],
  plannedChecks,
  sideEffects: {
    writes: false,
    codexLaunched: false,
    editorsRestarted: false,
    loginItemsChanged: false,
    oauthStarted: false
  }
};

if (jsonOutput) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  process.stdout.write(formatReport(report));
}

function formatReport(value) {
  const lines = [
    "macOS real side-effect verification plan",
    "",
    `Mode: ${value.executionMode}`,
    `Approval gate: ${value.approvalGate.env}=${value.approvalGate.acceptedValue}`,
    `Approval env currently set: ${value.approvalGate.currentlySet ? "yes" : "no"}`,
    "",
    "Prerequisites:",
    ...value.prerequisiteCommands.map((command) => `- ${command}`),
    "",
    "Checks requiring explicit approval:"
  ];

  for (const check of value.plannedChecks) {
    lines.push(`- ${check.id}: ${check.requirement}`);
  }

  lines.push(
    "",
    "No writes, launches, OAuth browser flow, editor restarts, or login-item changes were performed."
  );

  return `${lines.join("\n")}\n`;
}
