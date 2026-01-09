# Testing Methodology

This document outlines the testing strategy for the AsciiDoc Editor, covering both syntax highlighting and functional behavior.

## Overview

The project uses **Playwright** to run end-to-end tests.

## Test Suites

The tests are organized into the following suites:

### 1. Syntax Highlighting (`npm run test:syntax`)
These tests verify the correct tokenization of AsciiDoc content within the Monaco Editor by loading the editor in a browser environment, injecting AsciiDoc content, and using Monaco's internal API (`monaco.editor.tokenize`) to retrieve the generated tokens. These tokens are then compared against a set of expected values defined in JSON fixture files.
-   **File**: `tests/syntax_verification.spec.ts`
-   **Purpose**: Validates that AsciiDoc text is correctly tokenized.
-   **Method**: Data-driven tests that iterate through fixtures in `tests/fixtures/*.adoc`.

### 2. Editor Functionality (`npm run test:editor`)
These tests are further organized into:

-   **Editor Loading**: `tests/editor_loading.spec.ts`
    -   Verifies file system interactions, auto-saving, and UI state integrity.
-   **Directory Search**: `tests/directory_search.spec.ts`
    -   Verifies the file search feature, including UI interactions and filtering.
-   **Filesystem Operations**: `tests/filesystem_ops.spec.ts`
    -   Verifies renaming operations, conflict handling, and safety checks.

---

## General Testing Utilities

### Debugging Tests
Detailed logging (browser console, errors, dialogs) is available via the `test-debug:*` commands.

-   **Debug Syntax Tests**: `npm run test-debug:syntax`
-   **Debug Editor Tests**: `npm run test-debug:editor`

**Using Environment Variable:**
Alternatively, set `DEBUG_TESTS=1` manually:
```bash
# Windows
$env:DEBUG_TESTS=1; npx playwright test tests/filesystem_ops.spec.ts

# Linux/macOS
DEBUG_TESTS=1 npx playwright test tests/filesystem_ops.spec.ts
```
> [!NOTE]
> Avoid this approach as the variable will remain set and defeat the purpose of enabling logging only when needed.

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
To maintain clean and robust tests, we use reusable helper functions located in `tests/helpers/`. Avoid accessing window globals directly.

- **`editor_helpers.ts`**:
    - `setEditorContent(page, content)`: Sets the editor content by simulating user interactions (Click -> Ctrl+A -> Type).
    - `getEditorContent(page)`: Retrieves the current content from the editor store.
    - `disableAutoSave(page)`: Disables the auto-save mechanism for the current test.
- **`monaco_helpers.ts`**:
    - `waitForMonaco(page)`: Waits for the Monaco editor instance to be fully initialized and exposed on the window object.
- **`mock_helpers.ts`**:
    - `setMockPickerConfig(page, config)`: Configures the mock directory picker to simulate different directory selections.
- **`test_globals.ts`**:
    - `handleNextDialog(page, action)`: Schedules the next dialog to be automatically handled. Returns a handler object.
    - `handler.getMessage()`: Retrieves the message of the handled dialog. **Must be called AFTER the UI action has completed.**

    **Usage Pattern (Critical):**
    1. Schedule the handler *before* the action.
    2. Perform the action.
    3. Verify UI side-effects (ensure action completed).
    4. Call `getMessage()` to verify specific dialog content.

    ```typescript
    // Import from test_globals
    import { handleNextDialog } from './helpers/test_globals';

    // 1. Schedule handling BEFORE the action
    const dialogHandle = await handleNextDialog(page, 'confirm');

    // 2. Perform action that triggers dialog
    await page.click('button#delete-file');

    // 3. Verify UI changes (wait for action to complete)
    await expect(page.locator('text=Deleted File')).not.toBeVisible();

    // 4. Verify dialog message
    expect(await dialogHandle.getMessage()).toBe('Are you sure you want to delete this file?');
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