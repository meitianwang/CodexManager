#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="${SCRIPT_DIR}/team654301-card-tool-src"
DIST_DIR="${SCRIPT_DIR}/dist"
OUTPUT_PATH="${DIST_DIR}/Team654301 Card Tool.alfredworkflow"

mkdir -p "${DIST_DIR}"
rm -f "${OUTPUT_PATH}"

(
  cd "${SRC_DIR}"
  zip -qr "${OUTPUT_PATH}" .
)

echo "${OUTPUT_PATH}"
