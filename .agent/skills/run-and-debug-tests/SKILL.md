---
name: run-and-debug-tests
description: Guide for running and debugging tests, including filtering and interpreting logs.
---

# Run and Debug Tests

This skill outlines how to run the project's Playwright test suite, ranging from full suite execution to targeted debugging of individual tests.

## 1. Standard Execution

Use these standard commands for CI-like verification.

| Scope | Command | Description |
| :--- | :--- | :--- |
| **All Tests** | `npm test` | Runs all tests in standard mode. |
| **Syntax Only** | `npm run test:syntax` | Runs only `tests/syntax_verification.spec.ts`. |
| **Editor Only** | `npm run test:editor` | Runs all `tests/editor_*.spec.ts`. |
| **Components** | `npm run test:components` | Runs all `tests/components_*.spec.ts`. |

**Note**: All commands automatically set `PORT=8001`.

**Important**: Do not run `npx playwright` directly. Use the `npm run test` commands instead with appropriate arguments and options. Arguments pass through to playwright and options can be passed through with `--`.

Run multiple spec files with a single command as in the example below:
```bash
npm run test -- tests/editor_filesystem_ops.spec.ts tests/editor_filesystem_ops.spec.ts
```
This runs faster than running them separately by reusing the browser context and page.

## 2. Debug Execution

Use `test-debug` commands to enable detailed browser and dialog logging.

> [!CAUTION]
> **Avoid massive log output.**
> Debug commands generate significant output. **ALWAYS** filter to a specific test file or test case using the `-g` (grep) argument.

| Scope | Command |
| :--- | :--- |
| **Detailed Log** | `npm run test-debug -- <args>` |
| **Editor Debug** | `npm run test-debug:editor -- <args>` |

### Usage Examples

**Target a specific test case (Recommended):**
```bash
# Debug only the test named "rename directory" in editor tests
npm run test-debug:editor -- -g "rename directory"
```

**Target a specific file:**
```bash
# Debug all tests in tests/editor_filesystem_ops.spec.ts
npm run test-debug -- tests/editor_filesystem_ops.spec.ts
```

### Log Output Format

When running in debug mode (`DEBUG_TESTS=1`), the following prefixes appear in the console output:

- **`BROWSER: ...`**
    - Captures `console.log`, `console.warn`, and `console.error` from the browser context.
    - Useful for tracing application state, MobX reactions, or errors thrown inside the app.

- **`DIALOG: [type] "message"`**
    - Logs whenever a native dialog (`alert` or `confirm`) is triggered.
    - **Note**: The application should use `dialog.alert` and `dialog.confirm` and **never** use the native dialogs. Seeing this log indicates a need to change the application code. Native dialogs are always auto-dismissed to prevent hangs which may not be the desired behavior for `confirm`.

- **Errors**
    - Any unhandled exception or `console.error` in the browser will be re-thrown by `enableTestLogging` and **fail the test immediately**.

## 3. Best Practices

1. **Focus First**: Don't run `npm run test-debug` without arguments. It will take a long time and bury the relevant logs.
2. **Watch Mode**: For interactive debugging, you can use Playwright's UI mode:
   `cross-env PORT=8001 npx playwright test --ui`
3. **Clean State Check**: If a test fails mysteriously, ensure:
    - It uses `test.beforeEach` to set up `fsSetup`.
    - It cleans up dialogs/menus before finishing.
4. **Input Stability**: To avoid flakiness due to timing issues when sending keyboard events, make sure that the element that is expected to handle it is visible and / or focused before sending the key presses. For example, verify a context menu is visible *before* sending ArrowDown key presses to navigate it.
