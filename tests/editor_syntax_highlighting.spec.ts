import { helpers, test, expect } from './fixtures.ts';
import { loadInitialDirectory } from './helpers/sidebar_helpers.ts';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
});

test('Opening a .toml file sets the editor language to toml', async ({ page, fsSetup }) => {
    // Setup
    fsSetup.createFile('dir1', 'config.toml', '# This is a TOML file\nkey = "value"');

    // Open directory
    await loadInitialDirectory(page, 'dir1');

    // Click file
    await page.click('[data-testid="file-item"][data-file-path="config.toml"]');

    // Wait for file to load (by checking filename in title bar)
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('config.toml');

    // Verify language ID
    const langId = await helpers.getEditorLanguageId(page);
    expect(langId).toBe('toml');
});

test('Opening an .adoc file sets the editor language to asciidoc', async ({ page, fsSetup }) => {
    // Setup
    fsSetup.createFile('dir1', 'doc.adoc', '= Title');

    // Open directory
    await loadInitialDirectory(page, 'dir1');

    // Click file
    await page.click('[data-testid="file-item"][data-file-path="doc.adoc"]');

    // Wait for file to load
    await expect(page.locator('[data-testid="current-filename"]')).toHaveText('doc.adoc');

    // Verify language ID
    const langId = await helpers.getEditorLanguageId(page);
    expect(langId).toBe('asciidoc');
});
