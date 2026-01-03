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
- **Consequence**: `Welcome.adoc` is monitored by the custom watcher. Modifying it triggers `inject_welcome.ts` followed by a rebuild and browser reload automatically.

## 2. File System Access & State Management

### Browser File System Access API
The editor interacts directly with the user's local file system using the [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API).
- **Persistence**: Directory handles are persisted in IndexedDB using `idb-keyval`.
- **Permissions**: Browsers require a user gesture to grant read/write permissions.
  - When reloading the app with a persisted handle, we cannot verify permission immediately without a prompt.
  - We "restore" the handle in `FileSystemStore` but might wait for a user interaction (like clicking "Open Folder" or selecting a file) to re-prompt if permission has expired.
  - **Bypassing Persistence**: To load the application without restoring the previously selected directory (e.g., for automated testing or clean debugging), append `?skip_restore=true` to the URL.


### MobX Stores
- Stores (`EditorStore`, `FileSystemStore`) are singletons exported directly from their modules.
- We generally avoid React Context for these stores and import them directly, which simplifies usage but requires discipline to ensure they are mocked correctly during testing (if strictly unit testing components).

## 3. Styling
- We use **Vanilla Extract** (`.css.ts` files) for type-safe CSS-in-JS.
- This requires the `@vanilla-extract/esbuild-plugin` in `scripts/build.ts`.

## 4. Icons
- **Library**: We use [Font Awesome Free](https://fontawesome.com/) (`@fortawesome/fontawesome-free`) for all application icons.
- **Usage**:
  - Icons are used via standard `<i>` tags (e.g., `<i className="fa-solid fa-moon"></i>`).
  - **Do not** import individual React components for icons. Import the global CSS in `main.tsx` and use the class names.
  - To ensure correct loading, we use `dataurl` loaders in `scripts/build.ts` for font files (`.woff`, `.ttf`, etc.).
- **Consistency**: Use the "Solid" (`fa-solid`) style by default, or "Regular" (`fa-regular`) if a lighter weight is needed (e.g., for specific theme states).

## 5. Testing Methodology
- **Test Data Generation**: We use a custom flow for generating syntax highlighting tests.
  - `scripts/generate_test_data.ts` uses Playwright to spin up the editor, type content, and extract token information from Monaco.
  - This generates `*-tokens.json` and expectation files.
  - See `tests/testing_methodology.md` for full details.


### Test Scripts
| Command | Description |
| :--- | :--- |
| `npm test` | Runs all Playwright tests. |
| `npm run test:syntax` | Runs only syntax highlighting verification (`tests/syntax_verification.spec.ts`). |
| `npm run test:editor` | Runs editor functionality tests (`tests/editor_functionality.spec.ts`). |

## 6. Build System
- We use **esbuild** directly (via `scripts/build.ts`) instead of Vite or Webpack.
- **Custom Watch & Serve**:
  - We do not use esbuild's built-in `watch` or `serve` modes.
  - Instead, we use `fs.watch` (recursive) on the `src` directory to detect changes.
  - We run a custom Node.js `http` server to serve the `dist` directory.
  - **Live Reload**: We check for changes and use Server-Sent Events (SSE) to notify the browser to reload when a build completes.
- **Worker Handling**: Monaco Editor workers are explicitly bundled as separate entry points:
  ```typescript
  entryPoints: {
      'editor.worker': 'monaco-editor/esm/vs/editor/editor.worker.js',
      // ... other workers
  }
  ```

  }
  ```

### Editor Functionality Tests (`test:editor`)
We support end-to-end tests for file system interactions (opening folders, editing, auto-save).
- **Parallel Execution**: Tests run in parallel using Playwright's persistent context isolation.
- **File System Mocking**:
  - We mock the `window.showDirectoryPicker` API in `tests/helpers/fs_mock.js`.
  - File operations are bridged to the real file system via `page.exposeFunction` bindings.
  - **Unique Temp Directories**: Each test case creates a unique temporary directory (e.g., `adoc-editor-test-<random>`) to ensure isolation and safe parallel execution.

## 7. Debugging Features

### Monaco Tokens Visualization
We have a built-in tool to visualize the tokens generated by the Monaco tokenizer. This is useful for debugging syntax highlighting issues.

- **Enable**: Start the application with the `--show-tokens` flag (enabled by default in `npm start`).
- **Usage**:
  - A sidebar will appear on the right side of the editor.
  - It lists all tokens for the current file.
  - **Click** a token in the list to select it in the editor.
  - **Select** text in the editor to highlight the corresponding token in the list.
- **Production**: This feature is absent in production builds. It is only injected when the flag is present.

## 8. Coding Patterns & Disciplines

### React Components
- **Philosophy**: Keep React components "dumb".
- **Logic**: All business logic, state management, and even DOM ref management should be handled in MobX stores.
- **Components**: Components should primarily be observers that render state from stores and delegate events to store actions.
- **Hooks**: Avoid complex `useEffect` or `useState` logic within components. Use them only for lifecycle management (e.g., initializing/disposing stores) or strictly UI-local state that never leaves the component.

### MobX Stores
- **Decorators**: Use **explicit decorators** (`@observable accessor`, `@action`, `@computed`) for all store members.
- **Avoid Auto-Observable**: Do **not** use `makeAutoObservable(this)`. Explicit decorators provide better clarity and control, especially with newer standard decorator proposals.
- **Refs**: It is acceptable and encouraged to hold mutable values like DOM refs (`React.createRef`) in the store if they are needed for logic (e.g., scrolling).

### Test Globals
- **Convention**: Global variables exposed specifically for testing or debugging must be:
  - Prefixed with `__TEST_` (e.g. `__TEST_editorStore`).
  - Wrapped in a conditional check for `window.__ENABLE_TEST_GLOBALS__`.
- **Reasoning**: This prevents test-specific code from leaking into or being abused by production code, while still allowing access for integration tests (e.g., Playwright).
- **Example**:
  ```typescript
  if (typeof window !== 'undefined' && (window as any).__ENABLE_TEST_GLOBALS__) {
      (window as any).__TEST_myStore = myStore;
  }
  ```
- **Usage in Tests**:
  - In Playwright, enable globals via `await page.addInitScript('window.__ENABLE_TEST_GLOBALS__ = true;')` *before* loading the page.
  - Access globals via `window.__TEST_myStore`.

### Script Execution
- **Tool**: Use `node` directly for all scripts (e.g., `node scripts/generate_test_data.ts`).
- **Avoid**: Do not use `npx tsx` as it creates unnecessary overhead and dependencies. Modern Node.js supports running the TypeScript scripts in this project.
