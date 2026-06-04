#!/bin/bash
set -euo pipefail

# Safety rule: never kill by "Electron" alone.
# A process is cleaned only when both are true:
# 1. its command line matches this repo's dev startup chain;
# 2. its cwd is exactly apps/desktop.

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(cd "$script_dir/.." && pwd -P)"
desktop_dir="$repo_root/apps/desktop"
desktop_real="$(cd "$desktop_dir" && pwd -P)"
term_grace_seconds="${CODEX_MANAGER_DEV_TERM_GRACE_SECONDS:-3}"

log() {
  printf '[CodexManager dev] %s\n' "$*"
}

process_cwd() {
  local pid="$1"
  local cwd=""

  if command -v lsof >/dev/null 2>&1; then
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | awk '/^n/ { print substr($0, 2); exit }')"
  elif [[ -L "/proc/$pid/cwd" ]]; then
    cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  fi

  if [[ -n "$cwd" ]]; then
    (cd "$cwd" 2>/dev/null && pwd -P) || true
  fi
}

is_codex_manager_dev_command() {
  local command="$1"

  [[ "$command" == *"pnpm run dev"* ]] && return 0
  [[ "$command" == *"concurrently"* && "$command" == *"vite --host 127.0.0.1"* && "$command" == *"electron ."* ]] && return 0
  [[ "$command" == *"vite"* && "$command" == *"--host 127.0.0.1"* ]] && return 0
  [[ "$command" == *"wait-on"* && "$command" == *"tcp:5173"* ]] && return 0
  [[ "$command" == *"cross-env"* && "$command" == *"VITE_DEV_SERVER_URL=http://127.0.0.1:5173"* ]] && return 0
  [[ "$command" == *"Electron"* && "$command" == *" ."* ]] && return 0
  [[ "$command" == *"electron"* && "$command" == *" ."* ]] && return 0

  return 1
}

list_old_dev_pids() {
  candidate_dev_pids | while read -r pid; do
    [[ "$pid" =~ ^[0-9]+$ ]] || continue
    [[ "$pid" != "$$" && "$pid" != "${PPID:-}" ]] || continue

    local command
    command="$(ps -p "$pid" -o command= 2>/dev/null || true)"
    is_codex_manager_dev_command "$command" || continue

    local cwd
    cwd="$(process_cwd "$pid")"
    [[ "$cwd" == "$desktop_real" ]] || continue

    printf '%s\n' "$pid"
  done | sort -un
}

candidate_dev_pids() {
  if command -v pgrep >/dev/null 2>&1; then
    pgrep -f "pnpm run dev" 2>/dev/null || true
    pgrep -f "concurrently.*vite --host 127.0.0.1.*electron \\." 2>/dev/null || true
    pgrep -f "vite.*--host 127.0.0.1" 2>/dev/null || true
    pgrep -f "wait-on.*tcp:5173" 2>/dev/null || true
    pgrep -f "cross-env.*VITE_DEV_SERVER_URL=http://127.0.0.1:5173" 2>/dev/null || true
    pgrep -f "[Ee]lectron .*\\." 2>/dev/null || true
    return
  fi

  ps -axo pid=,ppid=,command= | while read -r pid ppid command; do
    if is_codex_manager_dev_command "$command"; then
      printf '%s\n' "$pid"
    fi
  done
}

pid_alive() {
  kill -0 "$1" 2>/dev/null
}

terminate_old_dev_processes() {
  if [[ "$#" -eq 0 ]]; then
    log "未发现旧的 CodexManager dev 进程"
    return
  fi

  local pids=("$@")
  local alive=()

  log "发现旧的 CodexManager dev 进程: ${pids[*]}"
  kill -TERM "${pids[@]}" 2>/dev/null || true

  local deadline=$((SECONDS + term_grace_seconds))
  while (( SECONDS < deadline )); do
    alive=()
    for pid in "${pids[@]}"; do
      if pid_alive "$pid"; then
        alive+=("$pid")
      fi
    done
    [[ "${#alive[@]}" -eq 0 ]] && return
    sleep 0.2
  done

  alive=()
  for pid in "${pids[@]}"; do
    if pid_alive "$pid"; then
      alive+=("$pid")
    fi
  done

  if [[ "${#alive[@]}" -gt 0 ]]; then
    log "旧进程未正常退出，强制清理: ${alive[*]}"
    kill -KILL "${alive[@]}" 2>/dev/null || true
  fi
}

old_pid_file="$(mktemp "${TMPDIR:-/tmp}/codexmanager-dev-pids.XXXXXX")"
trap 'rm -f "$old_pid_file"' EXIT
list_old_dev_pids > "$old_pid_file"

old_pids=()
while IFS= read -r pid; do
  [[ -n "$pid" ]] && old_pids+=("$pid")
done < "$old_pid_file"

if [[ "${#old_pids[@]}" -gt 0 ]]; then
  terminate_old_dev_processes "${old_pids[@]}"
else
  terminate_old_dev_processes
fi

log "启动 Electron dev app"
cd "$desktop_dir"
exec pnpm run dev
