import { test, expect } from './fixtures.ts';
import { loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
});

test('should apply default filtering (node_modules hidden, etc)', async ({ page, fsSetup }) => {
    // Setup file system
    fsSetup.createDirectory('dir1', 'node_modules');
    fsSetup.createFile('dir1', 'node_modules/pkg.json', '{}');
    fsSetup.createDirectory('dir1', '.git');
    fsSetup.createFile('dir1', 'normal.txt', 'hello');
    fsSetup.createFile('dir1', 'binary.exe', 'bin');
    fsSetup.createFile('dir1', 'script.js', 'console.log()');

    await loadInitialDirectory(page, 'dir1');

    // node_modules should be hidden by default
    await expect(page.locator('[data-dir-path="node_modules"]')).not.toBeVisible();

    // .git should be hidden (dot directory)
    await expect(page.locator('[data-dir-path=".git"]')).not.toBeVisible();

    // binary.exe should be hidden (default extension ignore)
    await expect(page.locator('[data-file-path="binary.exe"]')).not.toBeVisible();

    // normal files should be visible
    await expect(page.locator('[data-file-path="normal.txt"]')).toBeVisible();
    await expect(page.locator('[data-file-path="script.js"]')).toBeVisible();
});

test('should respect .adoc-editor/ignore.toml settings', async ({ page, fsSetup }) => {
    // Create config
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        ignored_directories = ["secret"]
        ignored_extensions = ["log"]
    `);

    fsSetup.createDirectory('dir1', 'secret');
    fsSetup.createFile('dir1', 'secret/file.txt', 'shh');
    fsSetup.createDirectory('dir1', 'public');
    fsSetup.createFile('dir1', 'app.log', 'error');
    fsSetup.createFile('dir1', 'app.txt', 'ok');

    await loadInitialDirectory(page, 'dir1');

    // "secret" directory should be hidden
    await expect(page.locator('[data-dir-path="secret"]')).not.toBeVisible();

    // "public" directory should be visible
    await expect(page.locator('[data-dir-path="public"]')).toBeVisible();

    // "app.log" should be hidden
    await expect(page.locator('[data-file-path="app.log"]')).not.toBeVisible();

    // "app.txt" should be visible
    await expect(page.locator('[data-file-path="app.txt"]')).toBeVisible();
});

test('should allow unignoring directories', async ({ page, fsSetup }) => {
    // node_modules is ignored by default. Let's unignore it.
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        unignored_directories = ["node_modules"]
    `);

    fsSetup.createDirectory('dir1', 'node_modules');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="node_modules"]')).toBeVisible();
});

test('should allow regex in ignored_directories', async ({ page, fsSetup }) => {
    // Ignore any directory starting with "test_"
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        ignored_directories = ["/test_.*/"]
    `);

    fsSetup.createDirectory('dir1', 'test_1');
    fsSetup.createDirectory('dir1', 'test_2');
    fsSetup.createDirectory('dir1', 'prod_1');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="test_1"]')).not.toBeVisible();
    await expect(page.locator('[data-dir-path="test_2"]')).not.toBeVisible();
    await expect(page.locator('[data-dir-path="prod_1"]')).toBeVisible();
});

test('should apply settings locally in subdirectories', async ({ page, fsSetup }) => {
    // Root: ignore "build"
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        ignored_directories = ["build"]
    `);

    fsSetup.createDirectory('dir1', 'build');

    fsSetup.createDirectory('dir1', 'sub');
    // Sub: unignore "build" (override) - wait, unignore checks "unignored_directories". 
    // And "merged" settings passed down? No, "unignored_directories" list is merged.
    // If "build" is in root "ignored", and in sub "unignored", does unignore win?
    // Logic: if unignored.some(...) return false.
    // So yes, unignore should win.

    fsSetup.createFile('dir1', 'sub/.adoc-editor/ignore.toml', `
        unignored_directories = ["build"]
    `);
    fsSetup.createDirectory('dir1', 'sub/build');
    fsSetup.createDirectory('dir1', 'sub/other');

    await loadInitialDirectory(page, 'dir1');

    // Root build invisible
    await expect(page.locator('[data-dir-path="build"]')).not.toBeVisible();

    // Sub folder visible
    await expect(page.locator('[data-dir-path="sub"]')).toBeVisible();

    // 'sub/build' should be visible
    await expect(page.locator('[data-dir-path="sub/build"]')).toBeVisible();
    await expect(page.locator('[data-dir-path="sub/other"]')).toBeVisible();
});

test('should support advanced extension matching and flags', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        ignore_extensionless_files = true
        ignored_extensions = [".log", ".g.cs", ".*"] 
        unignored_extensions = [".important.log"]
    `);

    // 1. Extensionless file
    fsSetup.createFile('dir1', 'makefile', '');
    // 2. Multi-dot extension matches
    fsSetup.createFile('dir1', 'style.g.cs', '');
    fsSetup.createFile('dir1', 'other.cs', '');
    // 3. Precedence: .important.log should be visible despite .log ignore
    fsSetup.createFile('dir1', 'app.important.log', '');
    fsSetup.createFile('dir1', 'trash.log', '');
    // 4. Wildcard .* matches anything with extension
    fsSetup.createFile('dir1', 'doc.txt', '');

    await loadInitialDirectory(page, 'dir1');

    // Extensionless ignored
    await expect(page.locator('[data-file-path="makefile"]')).not.toBeVisible();

    // .g.cs ignored
    await expect(page.locator('[data-file-path="style.g.cs"]')).not.toBeVisible();

    // .cs NOT ignored by .g.cs rule? 
    // Wait, I put ".*" in ignored_extensions, so EVERYTHING with extension should be ignored unless unignored.
    // So .cs should be hidden.
    await expect(page.locator('[data-file-path="other.cs"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="doc.txt"]')).not.toBeVisible();

    // .important.log UNIGNORED (Precedence: Unignore > Ignore)
    await expect(page.locator('[data-file-path="app.important.log"]')).toBeVisible();

    // trash.log IGNORED
    await expect(page.locator('[data-file-path="trash.log"]')).not.toBeVisible();
});

test('should verify boolean precedence vs unignore', async ({ page, fsSetup }) => {
    // Determine if Unignore wins over Dot File Ignore.
    fsSetup.createFile('dir1', '.adoc-editor/ignore.toml', `
        ignore_dot_files = true
        unignored_extensions = [".env"]
    `);

    fsSetup.createFile('dir1', '.env', 'secret');
    fsSetup.createFile('dir1', '.other', 'hidden');

    await loadInitialDirectory(page, 'dir1');

    // .env should be VISIBLE because Unignore > Boolean
    await expect(page.locator('[data-file-path=".env"]')).toBeVisible();

    // .other should be HIDDEN
    await expect(page.locator('[data-file-path=".other"]')).not.toBeVisible();
});
