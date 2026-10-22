import { test, expect } from './fixtures.ts';
import { loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
});

test('uses the in-memory defaults when the root .gitignore is absent', async ({ page, fsSetup }) => {
    fsSetup.createDirectory('dir1', 'node_modules');
    fsSetup.createFile('dir1', 'node_modules/pkg.json', '{}');
    fsSetup.createDirectory('dir1', '.git');
    fsSetup.createFile('dir1', '.private', 'hidden');
    fsSetup.createFile('dir1', 'normal.txt', 'hello');
    fsSetup.createFile('dir1', 'binary.exe', 'bin');
    fsSetup.createFile('dir1', 'script.js', 'console.log()');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="node_modules"]')).not.toBeVisible();
    await expect(page.locator('[data-dir-path=".git"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path=".private"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="binary.exe"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="normal.txt"]')).toBeVisible();
    await expect(page.locator('[data-file-path="script.js"]')).toBeVisible();
    // The fallback does not create a physical or synthetic configuration file.
    await expect(page.locator('[data-file-path=".gitignore"]')).not.toBeVisible();
    expect(fsSetup.exists('dir1', '.gitignore')).toBe(false);
});

test('an existing root .gitignore replaces defaults', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.gitignore', 'secret/\n*.log\n');
    fsSetup.createDirectory('dir1', 'secret');
    fsSetup.createDirectory('dir1', 'node_modules');
    fsSetup.createFile('dir1', 'app.log', 'error');
    fsSetup.createFile('dir1', 'app.txt', 'ok');
    fsSetup.createFile('dir1', 'binary.exe', 'bin');
    fsSetup.createFile('dir1', '.private', 'visible with replacement rules');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="secret"]')).not.toBeVisible();
    await expect(page.locator('[data-dir-path="node_modules"]')).toBeVisible();
    await expect(page.locator('[data-file-path="app.log"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="app.txt"]')).toBeVisible();
    await expect(page.locator('[data-file-path="binary.exe"]')).toBeVisible();
    await expect(page.locator('[data-file-path=".private"]')).toBeVisible();
});

test('an existing empty root .gitignore disables the fallback defaults', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.gitignore', '');
    fsSetup.createDirectory('dir1', 'node_modules');
    fsSetup.createFile('dir1', 'binary.exe', 'bin');
    fsSetup.createFile('dir1', '.private', 'visible');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="node_modules"]')).toBeVisible();
    await expect(page.locator('[data-file-path="binary.exe"]')).toBeVisible();
    await expect(page.locator('[data-file-path=".private"]')).toBeVisible();
});

test('applies ordered gitignore globs and negations', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.gitignore', '*.log\n!important.log\n');
    fsSetup.createFile('dir1', 'app.log', 'error');
    fsSetup.createFile('dir1', 'important.log', 'keep');
    fsSetup.createFile('dir1', 'notes.txt', 'keep');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-file-path="app.log"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="important.log"]')).toBeVisible();
    await expect(page.locator('[data-file-path="notes.txt"]')).toBeVisible();
});

test('nested .gitignore rules add a local scope while missing scopes inherit', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.gitignore', '*.tmp\n');
    fsSetup.createFile('dir1', 'root.tmp', 'ignored by root');
    fsSetup.createFile('dir1', 'sub/.gitignore', '!keep.tmp\nlocal.log\n');
    fsSetup.createFile('dir1', 'sub/keep.tmp', 'included by nested rule');
    fsSetup.createFile('dir1', 'sub/drop.tmp', 'inherited root rule');
    fsSetup.createFile('dir1', 'sub/local.log', 'local rule');
    fsSetup.createFile('dir1', 'sub/other/child.tmp', 'missing nested file inherits');
    fsSetup.createFile('dir1', 'sibling/keep.tmp', 'no nested scope here');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-file-path="root.tmp"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="sub/keep.tmp"]')).toBeVisible();
    await expect(page.locator('[data-file-path="sub/drop.tmp"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="sub/local.log"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="sub/other/child.tmp"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="sibling/keep.tmp"]')).not.toBeVisible();
});

test('an ignored parent is pruned before child negations can reopen it', async ({ page, fsSetup }) => {
    fsSetup.createFile('dir1', '.gitignore', 'private/\n!private/keep.txt\n');
    fsSetup.createFile('dir1', 'private/keep.txt', 'cannot reopen a pruned parent');

    await loadInitialDirectory(page, 'dir1');

    await expect(page.locator('[data-dir-path="private"]')).not.toBeVisible();
    await expect(page.locator('[data-file-path="private/keep.txt"]')).not.toBeVisible();
});
