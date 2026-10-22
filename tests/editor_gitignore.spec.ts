import { test, expect, helpers } from './fixtures.ts';
import { createIgnoreContext, isIgnoredEntry, isIgnoredPath } from '../src/file_system/GitIgnore.ts';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers.ts';
import { getDirectoryItem } from './helpers/locators.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createFile('workspace', '.gitignore', '');
    fsSetup.createFile('workspace', 'outside.txt', 'original outside');
    fsSetup.createFile('workspace', 'sub/inside.txt', 'inside');
});

test('matches ordered root and nested gitignore scopes with sibling isolation', async () => {
    const root = createIgnoreContext('', null, '*.tmp\n!keep.tmp\n/root-only.txt\nroot/*.log\n');
    const nested = createIgnoreContext('sub', root, '!drop.tmp\nlocal.log\n');
    const sibling = createIgnoreContext('sibling', root, '');

    expect(isIgnoredPath(root, 'file.tmp')).toBe(true);
    expect(isIgnoredPath(root, 'keep.tmp')).toBe(false);
    expect(isIgnoredPath(root, 'root-only.txt')).toBe(true);
    expect(isIgnoredPath(root, 'sub/root-only.txt')).toBe(false);
    expect(isIgnoredPath(nested, 'sub/drop.tmp')).toBe(false);
    expect(isIgnoredPath(nested, 'sub/other.tmp')).toBe(true);
    expect(isIgnoredPath(nested, 'sub/local.log')).toBe(true);
    expect(isIgnoredPath(sibling, 'sibling/local.log')).toBe(false);
});

test('honors directory pruning, directory-only patterns, metadata, and gitignore visibility', async () => {
    const root = createIgnoreContext('', null, 'locked/\n!locked/keep.txt\n*.TXT\n');

    expect(isIgnoredPath(root, 'locked', true)).toBe(true);
    expect(isIgnoredPath(root, 'locked/keep.txt')).toBe(true);
    expect(isIgnoredPath(root, 'notes.TXT')).toBe(true);
    expect(isIgnoredPath(root, '.git/config')).toBe(true);
    expect(isIgnoredPath(root, 'folder/.adoc-editor/settings')).toBe(true);
    expect(isIgnoredEntry(root, '.gitignore', '.gitignore', false)).toBe(false);
    expect(isIgnoredEntry(root, 'locked/.gitignore', '.gitignore', false)).toBe(true);
    expect(isIgnoredPath(root, 'folder/locked.txt')).toBe(false);
});

test('combines child directory reopening with direct ancestor rules', async () => {
    const root = createIgnoreContext('', null, 'foo/*\nfoo/**\n*.log\n');
    const child = createIgnoreContext('foo', root, '!bar/\n');

    // The ordered foo/** rule still excludes descendants directly.
    expect(isIgnoredPath(child, 'foo/bar/a.txt')).toBe(true);

    const shallowRoot = createIgnoreContext('', null, 'foo/*\n*.log\n');
    const shallowChild = createIgnoreContext('foo', shallowRoot, '!bar/\n');
    expect(isIgnoredPath(shallowChild, 'foo/bar', true)).toBe(false);
    expect(isIgnoredPath(shallowChild, 'foo/bar/a.txt')).toBe(false);
    expect(isIgnoredPath(shallowChild, 'foo/bar/a.log')).toBe(true);
});

test('supports globstar, escaped leading markers, CRLF, trailing spaces, and case sensitivity', async () => {
    const root = createIgnoreContext('', null, '# comment\r\n**/cache?.bin  \r\n\\#literal\r\n\\!literal\r\nCase.log\r\nfolder/\r\nfile[12].txt\r\nspace\\ name.txt\r\n');

    expect(isIgnoredPath(root, 'a/b/cache1.bin')).toBe(true);
    expect(isIgnoredPath(root, '#literal')).toBe(true);
    expect(isIgnoredPath(root, '!literal')).toBe(true);
    expect(isIgnoredPath(root, 'Case.log')).toBe(true);
    expect(isIgnoredPath(root, 'case.log')).toBe(false);
    expect(isIgnoredPath(root, 'file2.txt')).toBe(true);
    expect(isIgnoredPath(root, 'space name.txt')).toBe(true);
    expect(isIgnoredPath(root, 'folder', true)).toBe(true);
    expect(isIgnoredPath(root, 'folder')).toBe(false);
    expect(isIgnoredPath(root, 'folder/only.txt')).toBe(true);
});

test('subtree refresh applies changed ancestor rules and retains dirty excluded content', async ({ page, fsSetup }) => {
    await loadInitialDirectory(page, 'workspace');
    await page.click('[data-file-path="outside.txt"]');
    await expect(async () => expect(await helpers.getEditorContent(page)).toBe('original outside')).toPass();
    await helpers.setEditorContentDirect(page, 'unsaved outside content');
    await expect(async () => expect(await page.evaluate(() => (window as any).__TEST_editorStore.dirty)).toBe(true)).toPass();

    fsSetup.createFile('workspace', '.gitignore', 'outside.txt\n');
    await page.click('[data-dir-path="sub"]');
    await page.keyboard.press('F5');

    await expect(page.locator('[data-file-path="outside.txt"]')).not.toBeVisible();
    expect(await helpers.getEditorContent(page)).toBe('unsaved outside content');
    expect(await page.evaluate(() => (window as any).__TEST_fileSystemStore.currentFileNode?.kind)).toBe('external_file');

    await page.getByTestId('search-toggle-button').click();
    await page.getByTestId('search-input').fill('outside.txt');
    await expect(page.getByTestId('search-result-item')).toHaveCount(0);
});

test('refresh keeps an edited .gitignore as an explicit-save external file', async ({ page }) => {
    await loadInitialDirectory(page, 'workspace');
    const root = getDirectoryItem(page, '');
    await openContextMenu(page, root);
    await page.getByTestId('ctx-edit-ignore').click();
    await expect(async () => expect(await page.evaluate(() => (window as any).__TEST_fileSystemStore.currentFileNode?.kind)).toBe('external_file')).toPass();
    await helpers.setEditorContentDirect(page, 'unsaved rule edit');
    await expect(async () => expect(await page.evaluate(() => (window as any).__TEST_editorStore.dirty)).toBe(true)).toPass();

    await root.click();
    await page.keyboard.press('F5');

    expect(await page.evaluate(() => (window as any).__TEST_fileSystemStore.currentFileNode?.kind)).toBe('external_file');
    expect(await helpers.getEditorContent(page)).toBe('unsaved rule edit');
});
