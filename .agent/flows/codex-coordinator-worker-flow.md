# Codex coordinator/worker flow

This file is an execution protocol. Follow the tool-call order literally.

The coordinator performs repository exploration, design, decomposition, and final review. A worker performs one bounded investigation or implementation step in a fresh CLI context. Workers communicate only through request/result artifacts and the shared working tree.

The backend argument is mandatory for new calls:

```sh
./.agent/flows/run-worker.sh REQUEST_ARTIFACT RESULT_ARTIFACT codex
```

Use `agy` instead of `codex` only when the user explicitly selects agy.

## Required tool-call sequence

### 1. Create and verify artifacts

Create a run directory outside the repository:

```sh
RUN_DIR=/tmp/sheetkraft-codex-run-<unique-id>
mkdir -p "$RUN_DIR"
```

Create `$RUN_DIR/00-coordinator-plan.md` and `$RUN_DIR/01-worker-request.md`. The request must state exact scope, constraints, permitted commands, and the required result path `$RUN_DIR/01-worker-result.md`.

Write and verify artifacts in a completed command before starting the worker. Do not put artifact creation and worker launch in independent commands in the same shell invocation. Use `apply_patch` or `printf`, not `cat`.

Required verification:

```sh
test -s "$RUN_DIR/00-coordinator-plan.md" && test -s "$RUN_DIR/01-worker-request.md"
```

### 2. Launch exactly one worker

Call `functions.exec` with JavaScript equivalent to this. The nested `tools.exec_command` call must use `tty: true`, `yield_time_ms: 30000`, and return a `session_id`.

```javascript
const r = await tools.exec_command({
  cmd: "./.agent/flows/run-worker.sh /tmp/sheetkraft-codex-run-<unique-id>/01-worker-request.md /tmp/sheetkraft-codex-run-<unique-id>/01-worker-result.md codex",
  workdir: "/srv/devshare/projects/<repo>",
  tty: true,
  yield_time_ms: 30000,
  max_output_tokens: 12000
});
text(JSON.stringify(r));
```

Save the exact numeric `session_id` from the returned object. Do not start another worker. Do not inspect files, processes, result artifacts, or git status while this session is running.

### 3. Wait without polling or commentary

After launch, send no commentary updates. Do not call `exec_command`, `rg`, `git`, `ps`, `ls`, `test`, `cat`, `sed`, or an artifact-reading command. Do not call `write_stdin` repeatedly as a status poll.

Call one blocking `functions.exec` wait using the captured terminal session:

```javascript
// @exec: {"yield_time_ms": 300000, "max_output_tokens": 12000}
const r = await tools.write_stdin({
  session_id: <CAPTURED_SESSION_ID>,
  chars: "",
  yield_time_ms: 300000,
  max_output_tokens: 12000
});
text(JSON.stringify(r));
```

If the outer `functions.exec` call returns `Script running with cell ID N`, call `functions.wait` on that exact cell:

```json
{"cell_id":"N","yield_time_ms":300000,"max_tokens":12000}
```

This continues the blocked wait; it is not a new worker launch or a repository poll. If it reports the cell is still running, call `functions.wait` again on the same cell ID. Do not issue a new `tools.write_stdin` call and do not send commentary. Continue until the worker terminal returns a numeric `exit_code`.

Interpretation:

```text
numeric exit_code = worker completed; inspect handoff and diff
no exit_code = still running; continue waiting on the same cell/session
```

If launch returns no `session_id`, stop and ask the user to check the launcher. Do not infer completion from output, elapsed time, a result file, or process state.

### 4. Inspect only after exit

After receiving the numeric exit code, read the RESULT_ARTIFACT handoff. It must list changed files, commands/outcomes, unresolved issues, and recommendations.
A non-zero exit code does not imply a worker failure if RESULT_ARTIFACT exists.
If the result artifact is missing, report a worker failure, and inspect the diff to decide whether to launch a correction worker or use the work done.

The coordinator independently reviews the complete diff regardless of the handoff availability; review is never delegated.

### 5. Continue or finish

Only after inspection may the coordinator create the next request, launch another worker, make a trivial in-scope edit, run coordinator-owned checks, update roadmap evidence, or commit a reviewed increment. Repeat steps 1–5 serially. Never overlap worker sessions.

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

Workers must not attempt to use any prior context, or an unlisted communication channel. A worker may change the shared working tree only within its request scope.

## Launcher/runtime facts

`codex` launches an ephemeral `codex exec` context with `gpt-5.6-luna` at medium reasoning effort, `workspace-write`, and `approval_policy="never"`. `agy` launches noninteractive `gemini-3.8-flash-medium` with unattended permissions. The launcher opens a zellij pane, blocks until the selected CLI exits, and closes the pane.

The launcher renders structured CLI events through `./format-codex-exec.py`. Per-command output is limited to 40 lines and 6000 characters with a truncation marker. Output is not a completion signal; only the numeric terminal `exit_code` is a completion signal.

## Safety constraints

- Keep request/result artifacts outside the repository.
- Write and verify artifacts before launching.
- Launch one worker at a time.
- Never replace a running worker because it is slow or silent.
- Never inspect repository state while waiting.
- Never treat a result artifact appearing before terminal exit as completion.
- Do not delegate final review.
