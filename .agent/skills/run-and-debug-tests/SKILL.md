---
name: run-and-debug-tests
description: Guide for running and debugging tests, including common failure reasons and how to interpret logs.
---

# Run and Debug Tests

This skill outlines how to run the project's Playwright test suite and debug failures effectively.

## 1. The One Command to Rule Them All

**ALWAYS** use the following command to run, verify, and debug tests:

```bash
npm run test -- [options]
```

This command wraps a custom test runner script (`scripts/test_debug.ts`) that handles:
1.  **Environment Setup**: Automatically sets correct ports and environment variables.
2.  **Auto-Debug**: If a test fails, it **automatically** re-runs the *first* failed test in debug mode with detailed logging enabled.
3.  **Reporting**: Uses appropriate reporters for the context (concise for verification, detailed/JSON for debugging).

> [!CRITICAL]
> **NEVER** run `npx playwright test` directly.
> Doing so bypasses the environment setup, detailed logging, and auto-debug logic.

## 2. Running Specific Tests

Pass arguments to Playwright by placing them after the `--` separator.

| Goal | Command |
| :--- | :--- |
| **Run All Tests** | `npm run test` |
| **Run Specific File** | `npm run test -- tests/editor_filesystem.spec.ts` |
| **Filter by Title** | `npm run test -- -g "rename directory"` |
| **Headed Mode** | `npm run test -- --headed` |

## 3. Debugging Failures

When a test fails, the runner automatically switches to debug mode for that specific test. You will see output like:

> Test failure detected. Switching to debug mode for the first failing test...
> Running ... with args ...

### Log Output Format in Debug Mode

-   **`BROWSER: ...`**: Custom app logs (`console.log`, `console.warn`, `console.error`).
-   **`DIALOG: [type] "message"`**: Logs usage of `dialog.alert` or `dialog.confirm`.
-   **`ERROR: ...`**: Unhandled exceptions.

### Common Failure Reasons (Project Specific)

If a test fails, check these common pitfalls first:

1.  **Timing / Race Conditions**:
    -   *Symptom*: Element not found or action has no effect.
    -   *Cause*: Sending keyboard input (e.g., `ArrowDown`) before the target UI (e.g., Context Menu) is fully visible and focused.
    -   *Fix*: Assert visibility *before* interaction. `await expect(page.locator('...')).toBeVisible(); await page.keyboard.press('ArrowDown');`

2.  **Unclean State**:
    -   *Symptom*: Test fails because a file already exists or a dialog is unexpectedly open.
    -   *Cause*: Previous test didn't clean up (didn't close a dialog, didn't finish a rename).
    -   *Fix*: Ensure every test cleans up its UI actions. Use `helpers.handleNextDialog` for predictable dialog handling.

3.  **Focus Loss**:
    -   *Symptom*: Keyboard shortcuts (like F2 or Ctrl+S) don't work.
    -   *Cause*: Focus was not on the correct element (Sidebar Node vs Editor).
    -   *Fix*: Explicitly focus the target area before sending shortcuts.

4.  **Native Dialog Blocking**:
    -   *Symptom*: Browser hangs or test times out.
    -   *Cause*: Code used `window.confirm` instead of `dialog.confirm`.
    -   *Fix*: Refactor application code to use the custom `dialog` module.

## 4. Best Practices

1.  **Filter First**: Don't run the full suite repeatedly to debug one failure. Use `-g` to focus on the failing case.
2.  **One Command**: Don't try to construct complex `npx playwright` commands manually. Trust `npm run test`.
3.  **Read the Logs**: The auto-debug run provides rich information. Look for `BROWSER:` logs to understand the app's internal state at the time of failure.
