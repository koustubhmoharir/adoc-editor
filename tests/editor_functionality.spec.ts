import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to create a temporary directory unique to the test
const createTempDir = () => {
    return fs.mkdtempSync(path.join(os.tmpdir(), 'adoc-editor-test-'));
};

test.describe('Editor Functionality', () => {
    let tempDir: string;

    test.beforeEach(async ({ page }) => {
        tempDir = createTempDir();
        console.log(`Test running in temp dir: ${tempDir}`);

        // Populate temp dir with sample files
        fs.writeFileSync(path.join(tempDir, 'file1.adoc'), '== File 1\nContent of file 1.');
        fs.writeFileSync(path.join(tempDir, 'file2.adoc'), '== File 2\nContent of file 2.');
        fs.mkdirSync(path.join(tempDir, 'subdir'));
        fs.writeFileSync(path.join(tempDir, 'subdir', 'nested.adoc'), '== Nested\nContent of nested file.');
        fs.writeFileSync(path.join(tempDir, 'other.txt'), 'Ignored file'); // Should be ignored by filter

        // Expose bindings to bridge the mocked FS access in browser to Node fs
        await page.exposeFunction('__fs_readDir', async (dirPath: string) => {
            const fullPath = path.join(tempDir, dirPath);
            if (!fs.existsSync(fullPath)) return [];
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
            return entries.map(e => ({
                name: e.name,
                kind: e.isDirectory() ? 'directory' : 'file'
            }));
        });

        await page.exposeFunction('__fs_readFile', async (filePath: string) => {
            const fullPath = path.join(tempDir, filePath);
            return fs.readFileSync(fullPath, 'utf8');
        });

        await page.exposeFunction('__fs_writeFile', async (filePath: string, content: string) => {
            const fullPath = path.join(tempDir, filePath);
            fs.writeFileSync(fullPath, content);
        });

        await page.exposeFunction('__fs_stat', async (filePath: string) => {
            const fullPath = path.join(tempDir, filePath);
            try {
                const s = fs.statSync(fullPath);
                return { isDirectory: s.isDirectory(), isFile: s.isFile() };
            } catch (e) {
                throw new Error(`File not found: ${filePath}`);
            }
        });

        // Inject the mock implementation
        await page.addInitScript({ path: path.join(__dirname, 'helpers', 'fs_mock.js') });

        await page.goto('/?skip_restore=true');

        // Wait for Monaco to be ready just in case
        await page.waitForFunction(() => (window as any).monaco !== undefined, null, { timeout: 10000 });
    });

    test.afterEach(() => {
        try {
            fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (e) {
            console.error(`Failed to cleanup temp dir ${tempDir}:`, e);
        }
    });

    test('Opening a directory shows all adoc files within it recursively', async ({ page }) => {
        // Trigger open directory
        await page.click('button:has-text("Open Folder")');

        // Check for file items in sidebar using text
        // We look for the file names which should be rendered in the tree
        await expect(page.locator('text=file1.adoc')).toBeVisible();
        await expect(page.locator('text=file2.adoc')).toBeVisible();
        await expect(page.locator('text=subdir')).toBeVisible();
        await expect(page.locator('text=nested.adoc')).toBeVisible();

        // Check filter (should not show .txt)
        await expect(page.locator('text=other.txt')).not.toBeVisible();
    });

    test('Clicking on a file opens the file in the editor', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');

        // Click file1.adoc
        await page.click('text=file1.adoc');

        // Check editor content
        // We wait for content to be set
        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).editorStore.content);
            expect(editorContent).toBe('== File 1\nContent of file 1.');
        }).toPass();

        // Check title bar name
        await expect(page.locator('header')).toContainText('file1.adoc');
    });

    test('If there are no unsaved changes, opening a new directory does not change content on disk', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Ensure loaded
        await expect(page.locator('header')).toContainText('file1.adoc');

        // Click header to open directory again (simulating opening same or new dir)
        // In our mock, it returns the same root handle, but the action invokes save check.
        await page.click('[title="root"]'); // Header title is "root"

        // Check disk content intact
        const content = fs.readFileSync(path.join(tempDir, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If there are no unsaved changes, opening a different file does not change content on disk', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Switch to file 2
        await page.click('text=file2.adoc');
        await expect(page.locator('header')).toContainText('file2.adoc');

        // Check file1 content intact
        const content = fs.readFileSync(path.join(tempDir, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If any changes are made to the current file, they are auto-saved after a short delay', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Wait for file to load
        await expect(page.locator('header')).toContainText('file1.adoc');

        // Edit content
        await page.evaluate(() => {
            (window as any).editorStore.setContent('Updated content.');
        });

        // Dirty indicator visible
        // We should use text '*' if possible or robust selector. TitleBar.tsx: <span ...>*</span>
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Wait for auto-save (5s + buffer)
        // We can override the interval to speed up test?
        // Let's rely on standard wait for now, user did not demand speed but correctness.
        await page.waitForTimeout(5500);

        // Check disk content
        const content = fs.readFileSync(path.join(tempDir, 'file1.adoc'), 'utf8');
        expect(content).toBe('Updated content.');

        // Check dirty indicator gone
        await expect(page.locator('header span', { hasText: '*' })).not.toBeVisible();
    });

    test('If changes are made and a new file is opened, changes are saved before new file is opened', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Edit
        await page.evaluate(() => {
            (window as any).editorStore.setContent('Modified content before switch.');
        });

        // Wait for dirty state
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Switch to file 2 immediately
        await page.click('text=file2.adoc');

        // Verify file 2 loaded
        await expect(page.locator('header')).toContainText('file2.adoc');

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(tempDir, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content before switch.');
    });

    test('If changes are made and page is refreshed, changes are saved', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Edit
        await page.evaluate(() => {
            (window as any).editorStore.setContent('Modified content before refresh.');
        });

        // Wait for dirty state
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Trigger reload.
        // Note: The app needs to listen to 'beforeunload' or 'visibilitychange' to save?
        // Or essentially standard auto-save?
        // User requirement: "saved before the refresh or close is allowed to proceed"
        // This implies synchronous save or blocking.
        // FileSystemStore doesn't seem to have unloading logic in the code I read (only auto-save and manual save).
        // Let's check FileSystemStore.ts again.

        // Reload
        await page.reload();

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(tempDir, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content before refresh.');
    });

    test('Refreshing the page retains the selection', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');
        await expect(page.locator('header')).toContainText('file1.adoc');

        // Reload without skip_restore to test retention
        await page.goto('/');

        // Wait for restoration
        await expect(page.locator('header')).toContainText('file1.adoc'); // Filename should appear

        // Content should match
        await expect(async () => {
            const editorContent = await page.evaluate(() => (window as any).editorStore.content);
            // Should be original content if no edits
            expect(editorContent).toBe('== File 1\nContent of file 1.');
        }).toPass();
    });

});
