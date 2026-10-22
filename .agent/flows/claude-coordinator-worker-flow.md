# Claude coordinator/worker flow

This file is an execution protocol. Follow the tool-call order literally.

The coordinator performs repository exploration, design, decomposition, and final review. A worker performs one bounded investigation or implementation step in a fresh CLI context. Workers communicate only through request/result artifacts and the shared working tree.

The backend argument is mandatory for new calls:

```sh
./.agent/flows/run-worker.sh REQUEST_ARTIFACT RESULT_ARTIFACT codex
```

Use `agy` instead of `codex` only when the user explicitly selects that backend.

## Required tool-call sequence

### 1. Create and verify artifacts

Create a run directory outside the repository:

```sh
RUN_DIR=/tmp/sheetkraft-claude-run-<unique-id>
mkdir -p "$RUN_DIR"
```

Create `$RUN_DIR/00-coordinator-plan.md` and `$RUN_DIR/01-worker-request.md`. The request must state exact scope, constraints, permitted commands, and the required result path `$RUN_DIR/01-worker-result.md`.

Write and verify artifacts in a completed tool call before starting the worker. Use the `Write` tool to create both files.

Required verification:

```sh
test -s "$RUN_DIR/00-coordinator-plan.md" && test -s "$RUN_DIR/01-worker-request.md"
```

### 2. Launch exactly one worker in the background

Call the `Bash` tool with `run_in_background: true` set explicitly:

```json
{
  "command": "./.agent/flows/run-worker.sh /tmp/sheetkraft-claude-run-<unique-id>/01-worker-request.md /tmp/sheetkraft-claude-run-<unique-id>/01-worker-result.md claude",
  "run_in_background": true
}
```

Do not pass a `timeout` field on this call — a background call is not subject to the tool's foreground timeout, and this is precisely why it must be backgrounded rather than run in the foreground.

`run-worker.sh` opens a zellij pane with `--block-until-exit` and does not return control until that pane's process exits. Because the call is backgrounded, the immediate tool result only confirms the shell was started (it carries a shell/task id) — it is not the completion signal. The harness delivers a single, separate completion notification later, once `run-worker.sh` itself exits, carrying the worker's numeric exit code.

Do not start another worker. Do not inspect files, processes, result artifacts, or git status while this background shell is running.

### 3. Wait without polling or commentary

After the background `Bash` call is launched, take no further tool-call action of any kind — do not call `Bash`, `Monitor`, `Read`, `Grep`, or any other tool, and send no commentary — until the harness delivers the completion notification for that background shell.

Do not call `Monitor` to watch this shell: `run-worker.sh` already blocks until the pane closes and then exits on its own, so the background shell itself produces exactly one completion notification with no polling loop needed.

Do not issue a second `Bash` call to poll `ps`, `ls`, `git status`, or the result artifact while waiting. The only valid next action is to stop and let the completion notification arrive; it will surface later as its own message reporting the worker's exit code.

If the completion notification reports the worker was killed or errored out before finishing, that is a signal to shorten the worker's scope for the next request, not to relaunch the same worker in the background.

### 4. Inspect only after exit

After the completion notification for the background shell arrives with the worker's exit code, read the RESULT_ARTIFACT handoff. It must list changed files, commands/outcomes, unresolved issues, and recommendations.

A non-zero exit code does not imply a worker failure if RESULT_ARTIFACT exists.
If the result artifact is missing, report a worker failure, and inspect the diff to decide whether to launch a correction worker or use the work done.

The coordinator independently reviews the complete diff regardless of the handoff availability; review is never delegated.

### 5. Continue or finish

Only after inspection may the coordinator create the next request, launch another worker, make a trivial in-scope edit, run coordinator-owned checks, update roadmap evidence, or commit a reviewed increment. Repeat steps 1-5 serially. Never overlap worker runs.

After the final coordinator review, remove the temporary run directory:

```sh
rm -r "$RUN_DIR"
```

## Worker request requirements

Every request must explicitly state:

```text
- when, whether, and which tests to run to keep test run times low;
- exact files/features in scope;
- stop and report design ambiguities instead of working on assumptions;
- do not modify files outside the request scope;
- exact result-artifact path;
- create the result artifact with printf before exit;
```

Workers must not use `claude --resume`/`--continue`, prior worker context, or an unlisted communication channel. A worker may change the shared working tree only within its request scope.

## Launcher/runtime facts

`codex` launches an ephemeral `codex exec` context with `gpt-5.6-luna` at medium reasoning effort, `workspace-write`, and `approval_policy="never"`. `agy` launches noninteractive `gemini-3.8-flash-medium` with unattended permissions. The launcher opens a zellij pane, blocks until the selected CLI exits, and closes the pane.

The launcher renders structured CLI events through `./format-codex-exec.py`. Per-command output is limited to 40 lines and 6000 characters with a truncation marker.

Because the launching `Bash` call uses `run_in_background: true`, the initial tool result only confirms the shell started; the zellij pane still blocks on `--block-until-exit`, and when that pane's process exits, the harness delivers exactly one completion notification for that background shell carrying the worker's numeric exit code. Output is not a completion signal; only that completion notification is.

## Safety constraints

- Keep request/result artifacts outside the repository.
- Write and verify artifacts before launching.
- Launch one worker at a time.
- Always launch the worker with `run_in_background: true`; never run it as a foreground `Bash` call with a `timeout`.
- Never poll for completion with a second `Bash` call or with `Monitor` — wait only for the harness's own completion notification on the background shell.
- Never inspect repository state while the worker's background shell is running.
- Never treat a result artifact appearing before the completion notification as completion.
- Do not delegate final review.
