#!/usr/bin/env python3
"""Render codex exec JSONL as compact, TUI-like progress output."""

import argparse
from collections import deque
import json
import os
import sys
from typing import Any, Deque


RESET = "\033[0m"
CYAN = "\033[36m"
BLUE = "\033[94m"
DIM = "\033[2m"
GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"


def parameter_text(value: Any) -> str:
    """Return a tool argument's text, including AGY's JSON-encoded strings."""
    if not isinstance(value, str):
        return ""
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return value
    return decoded if isinstance(decoded, str) else value


def styled(value: str, color: str) -> str:
    """Add terminal styling without polluting redirected output."""
    if not sys.stdout.isatty() or os.environ.get("NO_COLOR") is not None:
        return value
    return f"{color}{value}{RESET}"


def compact_output(value: str, max_lines: int, max_chars: int) -> str:
    if not value:
        return ""

    lines = value.rstrip("\n").splitlines()
    truncated = len(lines) > max_lines
    lines = lines[:max_lines]
    output = "\n".join(lines)
    if len(output) > max_chars:
        output = output[:max_chars].rstrip()
        truncated = True

    if truncated:
        output += "\n… command output truncated …"
    return output


def parameter_value(parameters: dict[str, Any], names: tuple[str, ...]) -> str:
    """Find the first non-empty string parameter, allowing casing variants."""
    wanted = {name.lower().replace("_", "") for name in names}
    for key, value in parameters.items():
        if key.lower().replace("_", "") not in wanted:
            continue
        if isinstance(value, str) and value:
            return parameter_text(value)
        if isinstance(value, list) and value:
            values = [str(item) for item in value if item]
            if values:
                return ", ".join(values)
    return ""


def parameter_number(parameters: dict[str, Any], names: tuple[str, ...]) -> int | None:
    """Find the first integer parameter, allowing casing variants."""
    wanted = {name.lower().replace("_", "") for name in names}
    for key, value in parameters.items():
        if key.lower().replace("_", "") not in wanted:
            continue
        if isinstance(value, int) and not isinstance(value, bool):
            return value
        if isinstance(value, str):
            decoded = parameter_text(value)
            try:
                return int(decoded)
            except ValueError:
                pass
    return None


def line_range(parameters: dict[str, Any]) -> str:
    """Format AGY view_file's optional, 1-indexed inclusive line arguments."""
    start_line = parameter_number(parameters, ("StartLine",))
    end_line = parameter_number(parameters, ("EndLine",))
    if start_line is not None and end_line is not None:
        return f" (lines {start_line}-{end_line})"
    if start_line is not None:
        return f" (from line {start_line})"
    if end_line is not None:
        return f" (through line {end_line})"
    return ""


def display_path(path: str) -> str:
    """Shorten an absolute path when it is below the formatter's cwd."""
    if not os.path.isabs(path):
        return path

    repository_root = os.path.abspath(os.getcwd())
    absolute_path = os.path.abspath(path)
    try:
        relative_path = os.path.relpath(absolute_path, repository_root)
    except ValueError:
        # Different drives on Windows, or another platform-specific mismatch.
        return path

    if relative_path == os.pardir or relative_path.startswith(os.pardir + os.sep):
        return path
    return relative_path


def tool_label(
    tool_info: dict[str, Any], parameters: dict[str, Any], command: Any
) -> str:
    """Return a short, useful description for a tool lifecycle message."""
    tool_name = ""
    for key in ("name", "tool_name", "display_name"):
        value = tool_info.get(key)
        if isinstance(value, str) and value:
            tool_name = value
            break

    lowered_name = tool_name.lower()
    search_term = parameter_value(
        parameters,
        (
            "query",
            "search_term",
            "search_query",
            "pattern",
            "term",
            "needle",
            "text",
        ),
    )
    is_search = any(word in lowered_name for word in ("search", "find", "grep"))
    if is_search and search_term:
        return f"{tool_name or 'search'}: {search_term}"

    file_name = parameter_value(
        parameters,
        (
            "file",
            "file_name",
            "filename",
            "file_path",
            "filepath",
            "absolute_path",
            "target_file",
            "targetfile",
            "path",
            "target_path",
            "directory_path",
            "search_directory",
        ),
    )
    is_file_tool = file_name and any(
        word in lowered_name
        for word in ("file", "read", "write", "edit", "patch", "move", "copy", "delete")
    )
    if is_file_tool:
        range_suffix = ""
        if lowered_name.replace("_", "") == "viewfile":
            range_suffix = line_range(parameters)
        return f"{tool_name or 'file tool'}: {display_path(file_name)}{range_suffix}"

    if isinstance(command, str) and command:
        return command
    if tool_name:
        return tool_name
    return "tool"


def render_item(item: dict[str, Any], max_lines: int, max_chars: int) -> None:
    item_type = item.get("type")

    if item_type == "agent_message":
        text = item.get("text")
        if text:
            print(styled(text, CYAN), flush=True)
        return

    if item_type == "file_change":
        changes = item.get("changes")
        if isinstance(changes, list):
            paths = [
                display_path(change["path"])
                for change in changes
                if isinstance(change, dict) and isinstance(change.get("path"), str)
            ]
            if paths:
                print(styled("[files changed]", GREEN), flush=True)
                for path in paths:
                    print(styled(f"  {path}", GREEN), flush=True)
        return

    if item_type == "command_execution":
        command = item.get("command")
        if command:
            print(styled(f"$ {command}", BLUE), flush=True)

        output = compact_output(item.get("aggregated_output", ""), max_lines, max_chars)
        if output:
            print(styled(output, DIM), flush=True)

        status = item.get("status")
        exit_code = item.get("exit_code")
        if status == "completed" or exit_code is not None:
            print(styled(f"[{status or 'completed'}: exit {exit_code}]", GREEN), flush=True)
        return

    if item_type:
        print(styled(f"[{item_type}]", YELLOW), flush=True)


def render_agy_event(
    event: dict[str, Any],
    max_lines: int,
    max_chars: int,
    active_steps: dict[int, str],
    pending_tool_calls: Deque[tuple[str, Any]],
) -> bool:
    """Render an agy stream-json event and return whether it reports failure."""
    if event.get("event") == "step_update":
        update = event.get("step_update")
        if not isinstance(update, dict):
            return False

        step_index = update.get("step_index")
        step_type = update.get("step_type")
        state = update.get("state")
        if step_type == "agent_response":
            text = update.get("text_delta")
            if text:
                print(styled(text, CYAN), end="", flush=True)
            if state == "DONE" and text:
                print(flush=True)
            return state == "ERROR"

        if step_type == "tool":
            tool_info = update.get("tool_info")
            if not isinstance(tool_info, dict):
                tool_info = {}
            parameters = tool_info.get("parameters")
            if not isinstance(parameters, dict):
                parameters = {}
            command = parameters.get("CommandLine")
            label = tool_label(tool_info, parameters, command)

            if state == "ACTIVE" and isinstance(step_index, int):
                # PLANNER_RESPONSE may contain the useful tool name/arguments
                # before the lifecycle event. Consume that metadata here so
                # it improves this event without being rendered out of order.
                planned_label = ""
                planned_command = None
                if pending_tool_calls:
                    planned_label, planned_command = pending_tool_calls.popleft()
                has_tool_name = any(
                    isinstance(tool_info.get(key), str) and tool_info.get(key)
                    for key in ("name", "tool_name", "display_name")
                )
                if not has_tool_name and planned_label:
                    label = planned_label
                    command = planned_command
                if command:
                    print(styled(f"$ {command}", BLUE), flush=True)
                else:
                    print(styled(f"[calling: {label}]", YELLOW), flush=True)
                active_steps[step_index] = label

            if state in {"DONE", "ERROR"}:
                # agy normally repeats tool_info on the terminal event, but
                # retain the ACTIVE label because some versions omit it.
                if isinstance(step_index, int):
                    label = active_steps.pop(step_index, label)
                output = update.get("output") or tool_info.get("output")
                if output:
                    print(
                        styled(
                            compact_output(
                                str(output).replace("\r\n", "\n"), max_lines, max_chars
                            ),
                            DIM,
                        ),
                        flush=True,
                    )
                error = tool_info.get("error")
                if error:
                    print(styled(json.dumps(error, ensure_ascii=False), RED), flush=True)
                if state == "DONE":
                    # Filter out Completed status lines for view_file tool calls when used with agy
                    if "view_file" in label.lower():
                        pass  # Skip rendering this completed status line
                    else:
                        print(styled(f"[completed: {label}]", GREEN), flush=True)
                elif state == "ERROR":
                    print(styled(f"[failed: {label}]", RED), flush=True)
                return state == "ERROR"

    if event.get("event") == "result":
        result = event.get("result")
        if isinstance(result, dict) and result.get("status") != "SUCCESS":
            print(styled(json.dumps(result, ensure_ascii=False), RED), flush=True)
            return True

    return False


def capture_agy_transcript_event(
    event: dict[str, Any], pending_tool_calls: Deque[tuple[str, Any]]
) -> None:
    """Capture planner tool metadata for subsequent lifecycle events."""
    if event.get("type") != "PLANNER_RESPONSE":
        return
    tool_calls = event.get("tool_calls")
    if not isinstance(tool_calls, list):
        return
    for tool_call in tool_calls:
        if not isinstance(tool_call, dict):
            continue
        tool_name = tool_call.get("name")
        if not isinstance(tool_name, str):
            tool_name = ""
        parameters = tool_call.get("args")
        if not isinstance(parameters, dict):
            parameters = {}
        command = parameters.get("CommandLine")
        pending_tool_calls.append(
            (tool_label({"name": tool_name}, parameters, command), command)
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-lines", type=int, default=40)
    parser.add_argument("--max-chars", type=int, default=6000)
    args = parser.parse_args()

    failed = False
    active_agy_steps: dict[int, str] = {}
    pending_agy_tool_calls: Deque[tuple[str, Any]] = deque()
    rendered_codex_items: set[str] = set()
    for line in sys.stdin:
        if not line.strip():
            continue

        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            # Do not hide diagnostics if the CLI emits a non-JSON line.
            print(line.rstrip(), flush=True)
            continue

        if "event" in event:
            failed = render_agy_event(
                event,
                args.max_lines,
                args.max_chars,
                active_agy_steps,
                pending_agy_tool_calls,
            ) or failed
            continue

        capture_agy_transcript_event(event, pending_agy_tool_calls)

        event_type = event.get("type")
        if event_type in {"item.started", "item.completed"}:
            item = event.get("item")
            if isinstance(item, dict):
                item_type = item.get("type")
                item_id = item.get("id")
                already_rendered = isinstance(item_id, str) and item_id in rendered_codex_items

                # Agent messages may be delivered on either lifecycle event.
                # Render them at the first event carrying text, rather than
                # making them wait for an unrelated command to complete.
                render_now = (
                    item_type == "agent_message"
                    and isinstance(item.get("text"), str)
                    and bool(item["text"])
                    and not already_rendered
                )
                # File changes contain their affected paths at item.started;
                # report them immediately and do not repeat them at completion.
                render_now = render_now or (
                    item_type == "file_change"
                    and event_type in {"item.started", "item.completed"}
                    and not already_rendered
                )
                # Commands and other items retain their completion-only output.
                render_now = render_now or (
                    event_type == "item.completed"
                    and not already_rendered
                    and item_type not in {"agent_message", "file_change"}
                )
                if render_now:
                    render_item(item, args.max_lines, args.max_chars)
                    if isinstance(item_id, str):
                        rendered_codex_items.add(item_id)
        elif event_type == "error":
            print(styled(json.dumps(event, ensure_ascii=False), RED), flush=True)
            failed = True

    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
