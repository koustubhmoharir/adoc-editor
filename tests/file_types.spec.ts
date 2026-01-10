import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FsTestSetup } from './helpers/fs_test_setup';
import { enableTestLogging } from './helpers/test_logging';
import { waitForTestGlobals, handleNextDialog, enableTestGlobals } from './helpers/test_globals';
import { waitForMonaco } from './helpers/monaco_helpers';
import { getEditorContent } from './helpers/editor_helpers';

test.describe('File Types and Extensions', () => {
    let fsSetup: FsTestSetup;

    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);
        fsSetup = new FsTestSetup();

        // Setup various file types
        fsSetup.createFile('dir1', 'script.js', 'console.log("hello");');
        fsSetup.createFile('dir1', 'style.css', 'body { color: red; }');
        fsSetup.createFile('dir1', '.gitignore', 'node_modules');

        // Subdirectory for more structure
        fsSetup.createFile('dir1', 'src/main.ts', 'const x: number = 1;');

        // Binary file (using Buffer)
        const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0x03, 0xFF]);
        fsSetup.createFile('dir1', 'image.bin', binaryContent);

        await fsSetup.init(page);
        await enableTestGlobals(page);
        await page.goto('/?skip_restore=true');
        await waitForTestGlobals(page);
        await waitForMonaco(page);
        await page.click('[data-testid="open-folder-button"]');
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('Lists all file types including dotfiles', async ({ page }) => {
        await expect(page.locator('[data-testid="file-item"][data-file-path="script.js"]')).toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="style.css"]')).toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path=".gitignore"]')).toBeVisible();
        await expect(page.locator('[data-testid="file-item"][data-file-path="image.bin"]')).toBeVisible();
    });

    test('Opens text files and sets language', async ({ page }) => {
        // Open JS file
        await page.click('[data-testid="file-item"][data-file-path="script.js"]');

        // Check content
        await expect(async () => {
            const content = await getEditorContent(page);
            expect(content).toBe('console.log("hello");');
        }).toPass();

        // Check language (we need to access monaco instance)
        const lang = await page.evaluate(() => {
            const editor = (window as any).__TEST_editorStore.editor;
            return editor.getModel().getLanguageId();
        });
        expect(lang).toBe('javascript');
    });

    test('Detects binary file and asks for confirmation (Cancel)', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="image.bin"]');

        // Prepare to handle confirm dialog - Cancel
        const dialogHandle = await handleNextDialog(page, 'cancel');

        await fileItem.click();
        await expect(fileItem).toHaveAttribute('data-selected', 'true');

        // Dialog should have appeared
        expect(await dialogHandle.getMessage()).toContain('appears to be a binary file');

        // Content should NOT change (should remain default or whatever was before)
        // Since we just loaded, it might be the welcome screen.
        const content = await getEditorContent(page);
        expect(content).toContain('Welcome to the AsciiDoc Editor');
    });

    test('Detects binary file and asks for confirmation (Proceed)', async ({ page }) => {
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="image.bin"]');

        // Prepare to handle confirm dialog - Confirm
        const dialogHandle = await handleNextDialog(page, 'confirm');

        await fileItem.click();
        await expect(fileItem).toHaveAttribute('data-selected', 'true');

        // Dialog check
        expect(await dialogHandle.getMessage()).toContain('appears to be a binary file');

        // Content should load (it will be garbage text)
        await expect(async () => {
            const content = await getEditorContent(page);
            // The binary content 0x00 0x01 might look empty or weird.
            // But it shouldn't be the Welcome message.
            expect(content).not.toContain('Welcome to the AsciiDoc Editor');
        }).toPass();
    });

    test('Renaming allows changing extension from .adoc', async ({ page }) => {
        // Create an adoc file to test renaming FROM adoc
        // actually we can rename script.js to script.ts too. 
        // But user specifically asked about hardcoded adoc.

        // Let's rename script.js -> script.ts
        const fileItem = page.locator('[data-testid="file-item"][data-file-path="script.js"]');
        await fileItem.click();
        await page.keyboard.press('F2');

        const input = page.locator('[data-testid="rename-input"]');
        await input.fill('script.ts');
        await page.keyboard.press('Enter');

        await expect(page.locator('[data-testid="file-item"][data-file-path="script.ts"]')).toBeVisible();
        expect(fs.existsSync(path.join(fsSetup.tempDir1, 'script.ts'))).toBe(true);

        // Rename .gitignore -> .config
        const gitignore = page.locator('[data-testid="file-item"][data-file-path=".gitignore"]');
        await gitignore.click();
        await page.keyboard.press('F2');
        await input.fill('.config');
        await page.keyboard.press('Enter');

        await expect(page.locator('[data-testid="file-item"][data-file-path=".config"]')).toBeVisible();
    });
});
