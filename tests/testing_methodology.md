# Testing Methodology

This document outlines the testing strategy for the AsciiDoc Editor, covering both syntax highlighting and functional behavior.

## Overview

The project uses **Playwright** for end-to-end testing. The tests are designed to verify:
1.  **Syntax Highlighting**: Correct tokenization of AsciiDoc content by Monaco Editor.
2.  **Editor Functionality**: Valid file system interactions, state management, and UI behavior.

## Test Suites

The tests are organized into the following suites:

### 1. Syntax Highlighting (`npm run test:syntax`)
-   **File**: `tests/syntax_verification.spec.ts`
-   **Purpose**: Validates that AsciiDoc text is correctly tokenized.
-   **Method**: Data-driven tests that iterate through fixtures in `tests/fixtures/*.adoc`.

### 2. Editor Functionality (`npm run test:editor`)
This command runs all non-syntax tests, covering:

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
NOTE: Avoid this approach as the variable will remain set and defeat the purpose of enabling logging only when needed.

### File System Mocking
Tests involving file operations use `FsTestSetup` (from `tests/helpers/fs_test_setup.ts`) to create isolated test environments.

### Visual Debugging
To inspect the tokenizer or UI state manually:
1.  Run `npm start`.
2.  Open `http://localhost:8000/?skip_restore=true` (starts fresh).
3.  Use the **Tokens Visualization** sidebar to inspect token types.

---

## Deep Dive: Syntax Highlighting

The syntax verification framework compares actual Monaco tokens against expected tokens defined in JSON files.

### Workflow
1.  **Create Input**: Add a `.adoc` file to `tests/fixtures/`.
2.  **Generate Data**: Run `node scripts/generate_test_data.ts <filename>.adoc`.
3.  **Review**: Manually verify `tests/fixtures/<filename>.json`.

### Expectation File Format
```json
{
  "checks": [
    {
      "line": 0,
      "tokenContent": "= Header",
      "tokenTypes": ["keyword", "heading"]
    }
  ]
}
```