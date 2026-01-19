import { test, expect } from './fixtures';
import { loadInitialDirectory } from './helpers/sidebar_helpers';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createFile('status-bar-test', 'example.adoc', '= Example');
    fsSetup.createFile('status-bar-test', 'data.json', '{}');
});

test('should display current language and allow changing it', async ({ page }) => {
    await loadInitialDirectory(page, 'status-bar-test');

    // Open AsciiDoc file
    await page.click('[data-file-path="example.adoc"]');

    // Check language span shows 'asciidoc'
    const langSpan = page.getByTestId('status-bar-language');
    await expect(langSpan).toBeVisible();
    await expect(langSpan).toHaveText('asciidoc', { ignoreCase: true });

    // Click language button to open menu
    const langButton = page.getByTestId('status-bar-language-button');
    await langButton.click();

    // Verify menu is visible
    const menu = page.getByTestId('status-bar-language-menu');
    await expect(menu).toBeVisible();

    // Check for JSON option
    const jsonOption = page.getByTestId('language-option-json');
    await expect(jsonOption).toBeVisible();
    await expect(jsonOption).toHaveText(/json/i);

    // Click JSON option
    await jsonOption.click();

    // Verify status bar text changes
    await expect(langSpan).toHaveText('json', { ignoreCase: true });

    // Optional: Verify content is treated as JSON? 
    // We trust monaco.editor.setModelLanguage works if EditorStore logic is correct.
});
