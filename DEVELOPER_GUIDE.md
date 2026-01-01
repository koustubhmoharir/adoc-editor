# Developer Guide & Architectural Notes

This document outlines specific architectural decisions, custom build steps, and unique patterns used in the `adoc-editor` codebase. Developers should review this to understand non-standard behaviors.

## 1. Custom Build Steps

### Welcome Content Injection (`scripts/inject_welcome.ts`)
The application features a "Welcome" / "Help" screen that is displayed when no file is open.
- **Source**: The content is maintained in `src/components/Welcome.adoc` to allow for easy editing and native syntax highlighting.
- **Integration**: We do **not** fetch this file at runtime (to avoid network requests) nor do we hardcode the string in TypeScript (which is hard to maintain).
- **Mechanism**:
  - A pre-build script `scripts/inject_welcome.ts` runs before every `start` or `build` command.
  - It reads `src/components/Welcome.adoc`.
  - It locates `src/store/EditorStore.ts`.
  - It injects the content into `EditorStore.ts` between specific marker comments:
    ```typescript
    // MARKER: WELCOME_CONTENT_START
    const WELCOME_CONTENT = `...`;
    // MARKER: WELCOME_CONTENT_END
    ```
- **Consequence**: If you modify `Welcome.adoc`, you **must** restart the development server or run the injection script manualy for changes to take effect if the watcher doesn't pick up the pre-step (currently it relies on `npm start` restart).

## 2. File System Access & State Management

### Browser File System Access API
The editor interacts directly with the user's local file system using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API).
- **Persistence**: Directory handles are persisted in IndexedDB using `idb-keyval`.
- **Permissions**: Browsers require a user gesture to grant read/write permissions.
  - When reloading the app with a persisted handle, we cannot verify permission immediately without a prompt.
  - We "restore" the handle in `FileSystemStore` but might wait for a user interaction (like clicking "Open Folder" or selecting a file) to re-prompt if permission has expired.

### MobX Stores
- Stores (`EditorStore`, `FileSystemStore`) are singletons exported directly from their modules.
- We generally avoid React Context for these stores and import them directly, which simplifies usage but requires discipline to ensure they are mocked correctly during testing (if strictly unit testing components).

## 3. Styling
- We use **Vanilla Extract** (`.css.ts` files) for type-safe CSS-in-JS.
- This requires the `@vanilla-extract/esbuild-plugin` in `scripts/build.ts`.

## 4. Testing Methodology
- **Test Data Generation**: We use a custom flow for generating syntax highlighting tests.
  - `scripts/generate_test_data.ts` uses Playwright to spin up the editor, type content, and extract token information from Monaco.
  - This generates `*-tokens.json` and expectation files.
  - See `tests/testing_methodology.md` for full details.

## 5. Build System
- We use **esbuild** directly (via `scripts/build.ts`) instead of Vite or Webpack.
- **Worker Handling**: Monaco Editor workers are explicitly bundled as separate entry points:
  ```typescript
  entryPoints: {
      'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
      // ... other workers
  }
  ```
