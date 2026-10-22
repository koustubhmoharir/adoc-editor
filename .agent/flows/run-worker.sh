#!/usr/bin/env bash
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

if [[ $# -lt 2 || $# -gt 3 ]]; then
  echo "usage: $0 REQUEST_ARTIFACT RESULT_ARTIFACT [codex|agy]" >&2
  exit 2
fi

request_artifact=$1
result_artifact=$2
backend=${3:-codex}
repo_root=$(git rev-parse --show-toplevel)

case "$backend" in
  codex|agy) ;;
  *)
    echo "unsupported worker backend: $backend (expected codex or agy)" >&2
    exit 2
    ;;
esac

if [[ ! -f "$request_artifact" ]]; then
  echo "request artifact does not exist: $request_artifact" >&2
  exit 2
fi

mkdir -p "$(dirname "$result_artifact")"

if [[ -z "${ZELLIJ:-}" ]]; then
  echo "./run-worker.sh must be run inside a zellij session" >&2
  exit 2
fi

# Commands launched by the Codex app-server can inherit zellij metadata from
# an earlier session.  Do not let `zellij action` silently create or target a
# detached session in that case.  Callers may provide the known visible
# session explicitly; otherwise use the inherited session only after proving
# it is still addressable.
zellij_session=${ZELLIJ_TARGET_SESSION:-${ZELLIJ_SESSION_NAME:-}}

if [[ -z "$zellij_session" ]]; then
  echo "No zellij session is available. Set ZELLIJ_TARGET_SESSION to the visible session name." >&2
  exit 2
fi

zellij_panes=$(zellij --session "$zellij_session" action list-panes --json 2>&1) || true

if [[ "$zellij_panes" != \[* ]]; then
  echo "Zellij session '$zellij_session' is not addressable." >&2
  echo "Set ZELLIJ_TARGET_SESSION to the visible session name before launching a worker." >&2
  exit 2
fi

# Open the worker in the tab that hosts this script's own pane rather than
# whichever tab is focused.  ZELLIJ_PANE_ID identifies a terminal pane.
tab_args=()
if [[ -n "${ZELLIJ_PANE_ID:-}" ]]; then
  tab_id=$(python3 -c '
import json, sys
pane_id = int(sys.argv[1])
for pane in json.load(sys.stdin):
    if not pane["is_plugin"] and pane["id"] == pane_id:
        print(pane["tab_id"])
        break
' "$ZELLIJ_PANE_ID" <<<"$zellij_panes") || tab_id=
  if [[ -n "$tab_id" ]]; then
    tab_args=(--tab-id "$tab_id")
  fi
fi

worker_name=$(basename "$request_artifact")
worker_name=${worker_name//[^[:alnum:]_.-]/-}
raw_jsonl="/tmp/worker-agent-logs-sk/${worker_name}.${backend}.$(date -u +%Y%m%dT%H%M%SZ).jsonl"
mkdir -p "$(dirname "$raw_jsonl")"
worker_prompt="Read the worker request at $request_artifact. Work in the repository at $repo_root. Follow that request exactly. Perform detailed investigation, implementation, tests, and narrowly scoped iteration as requested. Before finishing, write the complete worker handoff to $result_artifact. Include work performed, files changed, commands and test outcomes, remaining problems, and recommendations for the next step. Do not start a new design phase."

case "$backend" in
  codex)
    pane_name="codex-worker-$worker_name"
    worker_command=(
      bash -o pipefail -c
      'raw_jsonl=$1; shift; codex exec --json "$@" | tee "$raw_jsonl" | python3 "$0"'
      "$script_dir/format-codex-exec.py"
      "$raw_jsonl"
      --ephemeral
      --model gpt-5.6-luna
      -c model_reasoning_effort=medium
      -c 'approval_policy="never"'
      -C "$repo_root"
      --sandbox workspace-write
      "$worker_prompt"
    )
    ;;
  agy)
    pane_name="agy-worker-$worker_name"
    worker_command=(
      bash -o pipefail -c
      'agy --output-format stream-json --dangerously-skip-permissions --model gemini-3.8-flash-medium --print-timeout 45m --print="$1" < /dev/null | tee "$2" | python3 -u "$0"'
      "$script_dir/format-codex-exec.py"
      "$worker_prompt"
      "$raw_jsonl"
    )
    ;;
esac

zellij --session "$zellij_session" action new-pane \
  "${tab_args[@]}" \
  --direction right \
  --name "$pane_name" \
  --cwd "$repo_root" \
  --close-on-exit \
  --block-until-exit \
  -- "${worker_command[@]}"

if [[ ! -f "$result_artifact" ]]; then
  echo "worker exited without creating result artifact: $result_artifact; raw JSONL is at: $raw_jsonl" >&2
  exit 1
fi

echo "worker completed: $result_artifact"
