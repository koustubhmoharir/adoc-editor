---
name: editor-test
description: Create a new end-to-end test for editor functionality following project testing methodology.
---

# Editor Test Creation

This skill guides the creation of end-to-end tests for the ADoc Editor using Playwright, adhering to the project's specific testing methodology and fixture system.

## 1. Imports & Fixtures

All tests MUST use the custom test fixture from `fixtures.ts` to ensure proper environment setup, isolation, cleanup, and helper availability.

```typescript
// ALWAYS import from fixtures.ts (adjust path depth as needed)
import { test, expect, helpers } from './fixtures';
```

### Core Helpers (`tests/fixtures.ts`)

These helpers are available via the `helpers` object:

- **`handleNextDialog(page, action)`**:
    - Pre-programs the handling of the *next* call to `dialog.alert` or `dialog.confirm`.
    - **Parameters**: `action` (boolean | null). Pass `true` for Confirm/Yes/OK, `false` for No, and `null` for Cancel/Escape.
    - **Usage**: Call *before* the action that triggers the dialog.
    - Returns a handle on which `getMessage()` can be called. This must be called *after* verifying the effect of the action that triggers the dialog. If the dialog was not shown, this will fail the test, so this should be called to verify that the dialog was shown as expected.
    - **Critical**: Do not attempt to dismiss the dialog by looking for buttons on the dialog and clicking them directly. `handleNextDialog` is the only reliable way to dismiss dialogs and it must be used for every dialog that the application is expected to show. The fixture will discard the browser context if a test finishes with dialogs that have not been dismissed, resulting in an undesirable slow down.

- **`setDirectoryPickerChoice(page, dirName)`**:
    - Configures the mock file picker to return a specific directory. Call this before clicking on the Open Directory button to control which directory is selected. Make sure to add expected files / directories to this directory in the `fsSetup` object from test.beforeEach. 
    - **Usage**: `await helpers.setDirectoryPickerChoice(page, 'my-dir');`

- **`getEditorContent(page)`**:
    - Reads the current editor content directly from the MobX store.
    - **Usage**: `const content = await helpers.getEditorContent(page);`

- **`setEditorContentDirect(page, content)`**:
    - Writes content directly to the MobX store. 
    - **Critical**: Use this instead of typing when a mock clock is installed (typing implies async Monaco workers which may stall).
    - **Usage**: `await helpers.setEditorContentDirect(page, 'New Content');`

- **`replaceEditorContentByTyping(page, content)`**:
    - Simulates user typing (Ctrl+A -> Type).
    - **Warning**: Do NOT use with mock clock.

- **`disableAutoSave(page)`**:
    - Disables the auto-save loop for precise state control. This is useful to avoid flakiness when testing keyboard navigation that can trigger auto save if it is slow during a concurrent test run.
    - **Usage**: `await helpers.disableAutoSave(page);`

- **`reloadPage(page, options)`**:
    - Reloads the page, optionally skipping state restoration. It should be used only by tests that need to verify persistence of data across a reload. Reloading is expensive so calling this will slow down the test.
    - **Usage**: `await helpers.reloadPage(page);`

- **`setupNewPage(page, fsSetup)`**: 
    - Use this only when a new page is created from within the test. It should not be used for a page that is received by the test.
    - Initializes test logging.
    - Registers file system mocks.
    - Sets up test globals (window.__TEST_*).
    - Navigates to the app with `?skip_restore=true`.
    - **Usage**: Automatically called by the `workerState` fixture, but can be manual if `browser.newContext()` is used.

## 2. Naming Conventions

- **Existing Files**: Add new tests to existing `tests/editor_*.spec.ts` files if they fit the category (e.g. `editor_filesystem_ops.spec.ts` for file operations).
- **New Files**: If creating a new file is necessary, it **MUST** start with the prefix `editor_` (e.g. `tests/editor_my_new_feature.spec.ts`).
    - **Reason**: The `npm run test:editor` command is configured to run only files matching `tests/editor_*.spec.ts`.

## 3. Test Structure Patterns

### File System Setup (`test.beforeEach`)

Use the `fsSetup` fixture to define the initial state of the virtual file system for *each* test.

```typescript
test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup(); // Ensure clean slate
    // Create initial files/directories
    // IMPORTANT: The first argument to `fsSetup.createFile` and `fsSetup.createDirectory` is the *name* of the top-level directory. This same name will be provided to `helpers.setDirectoryPickerChoice` and `loadInitialDirectory`. It MUST not contain a path separator. The second argument is the path to the file or directory to be created under the top-level directory. It can contain path separators to create a nested directory structure. Intermediate directories are created automatically.
    fsSetup.createFile('my-project', 'subdir/index.adoc', '= Hello World');
    fsSetup.createDirectory('my-project', 'subdir');
});
```

### Loading Initial State

Most editor tests should start by loading a directory.

```typescript
import { loadInitialDirectory } from './helpers/sidebar_helpers';

test('My Editor Test', async ({ page }) => {
    // 1. Load the directory defined in fsSetup
    await loadInitialDirectory(page, 'my-project');
    
    // 2. Assert initial state
    await expect(page.locator('[data-file-path="index.adoc"]')).toBeVisible();
});
```

### Locators & Data Attributes

**Never** use text-based selectors for dynamic content. Use strict data attributes:

- **Files**: `[data-file-path="my-dir/my-file.adoc"]` or `[data-testid="file-item"]`
- **Directories**: `[data-dir-path="my-dir"]`
- **Context Menus**: `[data-testid="context-menu"]`

## 4. Mock Clock Pattern

If testing time-sensitive features (debouncing, auto-save timers), you **MUST** use a fresh browser context and strictly **AVOID** the shared `page` fixture to prevent polluting native time functionality for other tests. Using the shared page will almost certainly cause subsequent tests to fail.

```typescript
test('Debounced Auto-Save', async ({ browser, fsSetup }) => {
    // 1. Create ISOLATED context
    const context = await browser.newContext();
    const page = await context.newPage();
    
    try {
        // 2. Setup standard environment manually
        await helpers.setupNewPage(page, fsSetup);
        
        // 3. Install Clock
        await page.clock.install();
        
        // 4. Test Logic
        // ... use setEditorContentDirect instead of typing ...
        await helpers.setEditorContentDirect(page, 'Changed');
        await page.clock.fastForward(2000);
        
    } finally {
        await context.close();
    }
});
```

## 5. Test Template

```typescript
import { test, expect, helpers } from './fixtures';
import { loadInitialDirectory } from './helpers/sidebar_helpers';

test.describe('Feature Name', () => {

    test.beforeEach(async ({ fsSetup }) => {
        fsSetup.cleanup();
        fsSetup.createFile('test-dir', 'example.adoc', '= Example');
    });

    test('should perform specific action', async ({ page }) => {
        // Initialize
        await loadInitialDirectory(page, 'test-dir');

        // Action
        await page.click('[data-file-path="example.adoc"]');

        // Verification
        const content = await helpers.getEditorContent(page);
        expect(content).toBe('= Example');
    });
});
```

## 6. Avoiding Flakiness

To avoid flakiness due to timing issues when sending keyboard events, make sure that the element that is expected to handle it is visible and / or focused before sending the key presses.

**Example**: When testing ArrowDown on a context menu, sending a right click followed by an ArrowDown is not good. After sending the right click we need to verify that the context menu is visible. Else, it is possible that the ArrowDown occurs before the context menu shows up and the test fails randomly.

