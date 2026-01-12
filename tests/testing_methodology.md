# Testing Methodology

This document outlines the testing strategy for the AsciiDoc Editor, covering both syntax highlighting and functional behavior.

## Overview

The project uses **Playwright** to run end-to-end tests.

## Test Suites

The tests are organized into the following suites:

### 1. Syntax Highlighting (`tests/syntax_verification.spec.ts`)
These tests verify the correct tokenization of AsciiDoc content within the Monaco Editor by loading the editor in a browser environment, injecting AsciiDoc content, and using Monaco's internal API (`monaco.editor.tokenize`) to retrieve the generated tokens. These tokens are then compared against a set of expected values defined in JSON fixture files.

### 2. Editor Functionality
These tests cover the core verification of the editor's features.

-   **Editor Loading** (`tests/editor_loading.spec.ts`):
    -   Verifies file system interactions, auto-saving, and UI state integrity.
-   **Filename Search** (`tests/editor_filename_search.spec.ts`):
    -   Verifies the file search feature, including UI interactions and filtering.
-   **Filesystem Operations** (`tests/editor_filesystem_ops.spec.ts`):
    -   Verifies renaming operations, conflict handling, and safety checks.
-   **File Types** (`tests/editor_file_types.spec.ts`):
    -   Verifies handling of different file types (dotfiles, binary files, code files) and language detection.
-   **Sidebar Navigation** (`tests/editor_sidebar_navigation.spec.ts`):
    -   Verifies keyboard navigation (Arrow keys, Enter, Escape), double-click behaviors, and directory expansion/collapse.
-   **Sidebar Menu** (`tests/editor_sidebar_menu.spec.ts`):
    -   Verifies context menu interactions (Right-click, customized options per type) and keyboard navigation within the menu.
-   **Dialogs** (`tests/components_dialog.spec.ts`):
    -   Verifies the custom dialog system (`alert`, `confirm`) and robust handling of sequential dialogs.

---

## General Testing Utilities

### Debugging Tests
Detailed logging (browser console, errors, dialogs) is available via the `test-debug:*` commands.

-   **Debug Syntax Tests**: `npm run test-debug:syntax`
-   **Debug Editor Tests**: `npm run test-debug:editor`

**Using Environment Variable:**
Alternatively, set `DEBUG_TESTS=1` manually:
```bash
cross-env DEBUG_TESTS=1 PORT=8001 npx playwright test tests/filesystem_ops.spec.ts
```
> [!NOTE]
> Do not set the environment variable at session scope as it will remain set and defeat the purpose of enabling logging only when needed.

### File System Mocking
Tests involving file operations use `FsTestSetup` (from `tests/helpers/fs_test_setup.ts`) to create isolated test environments.

### Visual Debugging
To inspect the tokenizer or UI state manually:
1.  Run `npm start`.
2.  Open `http://localhost:8000/?skip_restore=true` (starts fresh).
3.  Paste the asciidoc content into the editor.
4.  Use the **Tokens Visualization** sidebar to inspect token types.


You can also open the directory of fixtures to visualize the tokens. Tokens that are verified as part of the test case are shown with a green check mark.

### Test Helpers
To maintain clean and robust tests, we use reusable helper functions.
**Most core helpers are located in `tests/fixtures.ts` and exported via the `helpers` object.**

- **`tests/fixtures.ts` (Core Helpers)**:
    - `helpers.setupNewPage(page, fsSetup)`: Sets up a fresh test environment (logging, mocks, globals).
    - `helpers.reloadPage(page, options)`: Reloads the page, optionally skipping state restoration.
    - `helpers.getEditorContent(page)`: Retrieves the current content from the editor store.
    - `helpers.setEditorContentDirect(page, content)`: Sets editor content directly via the store (bypassing typing).
    - `helpers.handleNextDialog(page, action)`: Schedules the next dialog to be automatically handled.

- **`tests/helpers/sidebar_helpers.ts`**:
    - `loadInitialDirectory(page, dirName)`: Opens a directory via the mock picker.
    - `triggerRename(page, fileItem)`: Initiates the rename flow.

- **`tests/helpers/monaco_helpers.ts`**:
    - `waitForMonaco(page)`: Waits for the Monaco editor instance to be initialized.


### Best Practices & Patterns

#### 1. Fixture Usage
Always import `test` and `expect` from `./fixtures.ts` (or `../fixtures.ts` depending on depth). This ensures you get the custom test fixture that provides a per-worker browser context and a shared page in a clean state within that browser context with global test variables properly setup.

```typescript
import { test, expect, helpers } from './fixtures';
```

#### 2. File System Setup
Use `fsSetup` in `test.beforeEach` to define the initial state of the virtual file system for your test.
```typescript
test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup(); // Good practice to ensure clean slate
    fsSetup.createFile('dir1', 'hello.adoc', 'Hello World');
});
```

#### 3. Initialization
Most tests should start by loading a directory to get the app into a state where the mocked directory created in beforeEach is loaded in the sidebar. Ensure that you specify the same directory name as the one used to create mock files in beforeEach.
```typescript
import { loadInitialDirectory } from './helpers/sidebar_helpers';

test('My Test', async ({ page }) => {
    // This helper sets the mock picker choice and clicks "Open Folder"
    await loadInitialDirectory(page, 'dir1');
    // ... test logic
});
```

#### 4. Clean State Policy
Tests must clean up their UI state before finishing. Close any open dialogs, menus, or context menus, and complete or cancel any file renames.
- **Why?** We reuse the browser context/page between tests for performance. If a test leaves some unclean state that the fixture is not able to detect, the next test might fail.
- **Enforcement**: If a test fails or marks the worker as "dirty" based on attempts to detect unclean state, the test runner will discard the context and create a fresh one for the next test. Note that there is a significant performance penalty to this as the cost of loading the page is usually much more than the cost of running the test steps.

#### 5. Mock Clock Caveat
If you use `page.clock.install()` (to test debouncing or timeouts), **DO NOT** use `page.keyboard.type()` or `helpers.replaceEditorContentByTyping()`. Also, **DO NOT** use the shared page. Let the test take a browser object and create a new context. Close the context in a finally block.
- **Reason**: Monaco Editor uses internal async workers and timers that may stall or behave unpredictably when the system time is frozen/mocked.
- **Solution**: Use `helpers.setEditorContentDirect(page, content)` to update the model immediately without relying on typing events.

#### 6. Error Handling
Any unhandled exception in the application will automatically **FAIL** the test. This logic is baked into `enableTestLogging` that is called to setup a page. Ensure that the application code handles expected errors gracefully.

If the application code calls console.error or console.warn, these are reflected in the test output but do not fail the test itself.

#### 7. Locators
- **Avoid `hasText`**: Do not use text-based locators (`:has-text(...)` or `getByText`) for dynamic content like file items or editor content. They are brittle.
- **Use Data Attributes**: Prefer `data-testid`, `data-file-path`, or `data-dir-path`. Add specific data attributes in the application code wherever required for robust testing.
  ```typescript
  // Bad
  page.locator('.file-item:has-text("my-file.adoc")');
  
  // Good
  page.locator('[data-testid="file-item"][data-file-path="my-file.adoc"]');
  ```

#### 8. Dialog Handling
Use the `handleNextDialog` pattern to test native/custom dialogs robustly.

```typescript
// 1. Schedule the handler *before* the action
const dialogHandle = await helpers.handleNextDialog(page, 'confirm');

// 2. Perform action that triggers dialog
await page.click('button#delete-file');

// 3. Verify UI side-effects (ensure action completed)
await expect(page.locator('text=Deleted File')).not.toBeVisible();

// 4. Call getMessage() to verify specific dialog content
expect(await dialogHandle.getMessage()).toBe('Are you sure?');
```


---

## Deep Dive: Syntax Highlighting

The syntax verification framework is unique to this project. It compares actual Monaco tokens against expected tokens defined in JSON files.

### Syntax Test Structure
- **Fixtures Directory**: `tests/fixtures/`
  - Contains `.adoc` files (the input text).
  - Contains `.json` files (the expected token structure). Note that these files are generated using the `npm run generate-test-data` command. The logic in the scripts/generate_expectations.ts file should be modified when necessary instead of modifying this file directly.
  - Contains `-tokens.json` files (generated debug output showing actual tokens).

### Verification Logic
The verification process for each test case is as follows:

1.  **Tokenization**: The `.adoc` content is tokenized by Monaco.
2.  **Sequential Matching**: The test iterates through the checks defined in the `.json` fixture.
3.  **Token Lookup**: For each check:
    - It looks at the specified `line`.
    - It searches for the *first* token that matches the `tokenContent` string.
    - **Crucially**, the search resumes *after* the index of the previously matched token on that line. This ensures that duplicate words on the same line are checked in the correct order.
4.  **Type Assertion**: Once the matching token is found, the test verifies that its `type` property contains **all** the specific segments listed in `tokenTypes` (AND logic).

### Adding a New Test Case
To add a new syntax highlighting test:

1.  **Create Input**: Create a new file in `tests/fixtures/` with the `.adoc` extension (e.g., `my_feature.adoc`) and add the AsciiDoc content you want to test.
2.  **Generate Test Data**: Run the automated generation script:
    ```bash
    node scripts/generate_test_data.ts my_feature.adoc
    ```
    This script will automatically:
    - **Analyze** the `.adoc` file to determine high-level token expectations.
    - **Generate Tokens** using a dedicated Playwright script (re-using the browser if running in batch with `--all`).
    - **Generate Expectations** by merging the analysis and raw tokens into `my_feature.json`.
    - **Verify** the test by running the verification suite.

3.  **Review**: Inspect the generated `my_feature.json` to ensure the expectations are correct.

### Expectation File Format (`.json`)
The expectations file defines a list of checks. Each check verifies a specific token.

```json
{
  "checks": [
    {
      "line": 0,                     // 0-indexed line number
      "tokenContent": "= Header",    // The exact text text of the token to match
      "tokenTypes": [                // The expected types (classes) the token must have
        "keyword",
        "heading"
      ]
    },
    {
      "line": 2,
      "tokenContent": "**",
      "tokenTypes": ["strong"]
    }
  ]
}
```

- **`line`**: The line number where the token appears (starting from 0).
- **`tokenContent`**: The exact substring of the text that this token covers.
- **`tokenTypes`**: A list of strings. The test verifies that the actual token's type string contains *all* of these strings. For example, if `tokenTypes` is `["bold"]`, it will match `strong.bold` or `bold.text`.