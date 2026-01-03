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
    let tempDir1: string;
    let tempDir2: string;

    test.beforeEach(async ({ page }) => {
        tempDir1 = createTempDir();
        tempDir2 = createTempDir();
        console.log(`Test running in temp dirs: ${tempDir1}, ${tempDir2}`);

        // Populate temp dir 1
        fs.writeFileSync(path.join(tempDir1, 'file1.adoc'), '== File 1\nContent of file 1.');
        fs.writeFileSync(path.join(tempDir1, 'file2.adoc'), '== File 2\nContent of file 2.');
        fs.mkdirSync(path.join(tempDir1, 'subdir'));
        fs.writeFileSync(path.join(tempDir1, 'subdir', 'nested.adoc'), '== Nested\nContent of nested file.');
        fs.writeFileSync(path.join(tempDir1, 'other.txt'), 'Ignored file');

        // Populate temp dir 2
        fs.writeFileSync(path.join(tempDir2, 'dir2_file.adoc'), '== Dir2 File\nContent of dir2 file.');

        // Helper to resolve path based on prefix (dir1 or dir2)
        const resolvePath = (virtualPath: string) => {
            // Paths from mock come as "dir1/file...", "dir2/file..." or "dir1" (if root listing)
            // Sometimes relative paths might be passed if internal logic differs, but our mock sends "rootname/path" structure
            // Mock uses format: "{name}/{entryName}" for children.
            // But root handle path is just "dir1".
            // listing "dir1" -> read tempDir1.

            const parts = virtualPath.split(/[/\\]/);
            const root = parts[0];
            const rest = parts.slice(1).join(path.sep);

            if (root === 'dir1') return path.join(tempDir1, rest);
            if (root === 'dir2') return path.join(tempDir2, rest);

            // Fallback or error?
            // If path is just '.' (old mock default), map to dir1?
            if (virtualPath === '.') return tempDir1;

            // Should not happen with new mock config
            throw new Error(`Unknown virtual path root: ${root} in ${virtualPath}`);
        };

        // Expose bindings to bridge the mocked FS access in browser to Node fs
        await page.exposeFunction('__fs_readDir', async (dirPath: string) => {
            const fullPath = resolvePath(dirPath);
            if (!fs.existsSync(fullPath)) return [];
            const entries = fs.readdirSync(fullPath, { withFileTypes: true });
            return entries.map(e => ({
                name: e.name,
                kind: e.isDirectory() ? 'directory' : 'file'
            }));
        });

        await page.exposeFunction('__fs_readFile', async (filePath: string) => {
            const fullPath = resolvePath(filePath);
            return fs.readFileSync(fullPath, 'utf8');
        });

        await page.exposeFunction('__fs_writeFile', async (filePath: string, content: string) => {
            const fullPath = resolvePath(filePath);
            const dir = path.dirname(fullPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, content);
        });

        await page.exposeFunction('__fs_stat', async (filePath: string) => {
            const fullPath = resolvePath(filePath);
            try {
                const s = fs.statSync(fullPath);
                return { isDirectory: s.isDirectory(), isFile: s.isFile() };
            } catch (e) {
                throw new Error(`File not found: ${filePath} (resolved: ${fullPath})`);
            }
        });

        // Inject the mock implementation
        await page.addInitScript('window.__ENABLE_TEST_GLOBALS__ = true;');
        await page.addInitScript({ path: path.join(__dirname, 'helpers', 'fs_mock.js') });

        await page.goto('/?skip_restore=true');

        // Wait for Monaco to be ready just in case
        await page.waitForFunction(() => (window as any).__TEST_monaco !== undefined, null, { timeout: 10000 });
    });

    test.afterEach(() => {
        try {
            fs.rmSync(tempDir1, { recursive: true, force: true });
            fs.rmSync(tempDir2, { recursive: true, force: true });
        } catch (e) {
            console.error(`Failed to cleanup temp dirs`, e);
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
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
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

        // Switch to dir2
        await page.evaluate(() => {
            (window as any).__mockPickerConfig = { name: 'dir2', path: 'dir2' };
        });

        // Open directory again (click current directory name in sidebar)
        await page.click('[title="dir1"]');

        // Check if dir2 loaded
        await expect(page.locator('text=dir2_file.adoc')).toBeVisible();

        // Select file in dir2
        await page.click('text=dir2_file.adoc');
        await expect(page.locator('header')).toContainText('dir2_file.adoc');

        // Check disk content of file1 in dir1 was not changed
        const content = fs.readFileSync(path.join(tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If there are no unsaved changes, opening a different file does not change content on disk', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Switch to file 2
        await page.click('text=file2.adoc');
        await expect(page.locator('header')).toContainText('file2.adoc');

        // Check file1 content intact
        const content = fs.readFileSync(path.join(tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('== File 1\nContent of file 1.');
    });

    test('If any changes are made to the current file, they are auto-saved after a short delay', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Wait for file to load
        await expect(page.locator('header')).toContainText('file1.adoc');

        // Edit content
        await page.evaluate(() => {
            (window as any).__TEST_editorStore.setContent('Updated content.');
        });

        // Dirty indicator visible
        // We should use text '*' if possible or robust selector. TitleBar.tsx: <span ...>*</span>
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Wait for auto-save (5s + buffer)
        // We can override the interval to speed up test?
        // Let's rely on standard wait for now, user did not demand speed but correctness.
        await page.waitForTimeout(5500);

        // Check disk content
        const content = fs.readFileSync(path.join(tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Updated content.');

        // Check dirty indicator gone
        await expect(page.locator('header span', { hasText: '*' })).not.toBeVisible();
    });

    test('If changes are made and a new file is opened, changes are saved before new file is opened', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Edit
        await page.evaluate(() => {
            (window as any).__TEST_editorStore.setContent('Modified content before switch.');
        });

        // Wait for dirty state
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Switch to file 2 immediately
        await page.click('text=file2.adoc');

        // Verify file 2 loaded
        await expect(page.locator('header')).toContainText('file2.adoc');

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(tempDir1, 'file1.adoc'), 'utf8');
        expect(content).toBe('Modified content before switch.');
    });

    test('If changes are made and page is refreshed, changes are saved', async ({ page }) => {
        await page.click('button:has-text("Open Folder")');
        await page.click('text=file1.adoc');

        // Edit
        await page.evaluate(() => {
            (window as any).__TEST_editorStore.setContent('Modified content before refresh.');
        });

        // Wait for dirty state
        await expect(page.locator('header span', { hasText: '*' })).toBeVisible();

        // Reload
        await page.reload();

        // Verify file 1 saved
        const content = fs.readFileSync(path.join(tempDir1, 'file1.adoc'), 'utf8');
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
            const editorContent = await page.evaluate(() => (window as any).__TEST_editorStore.content);
            // Should be original content if no edits
            expect(editorContent).toBe('== File 1\nContent of file 1.');
        }).toPass();
    });

    test('Nested directory states are persisted correctly', async ({ page }) => {
        // Setup deep structure in tempDir1
        const level1 = path.join(tempDir1, 'level1');
        const level2 = path.join(level1, 'level2');
        const level3 = path.join(level2, 'level3');
        fs.mkdirSync(level3, { recursive: true });
        fs.writeFileSync(path.join(level3, 'deep_file.adoc'), '== Deep File');

        // Refresh file explorer by opening folder again (or just start here)
        await page.click('button:has-text("Open Folder")');

        // Verify initial state: All expanded by default
        // level1 visible in Sidebar
        await expect(page.locator('text=level1')).toBeVisible();
        // level2 visible
        await expect(page.locator('text=level2')).toBeVisible();
        // level3 visible
        await expect(page.locator('text=level3')).toBeVisible();
        // deep_file visible
        await expect(page.locator('text=deep_file.adoc')).toBeVisible();

        // Collapse level3. (State: level1=Open, level2=Open, level3=Collapsed)
        await page.click('text=level3');
        // deep_file should hide
        await expect(page.locator('text=deep_file.adoc')).not.toBeVisible();

        // Collapse level1. (State: level1=Collapsed, level2=? (hidden), level3=Collapsed)
        await page.click('text=level1');
        // level2 should hide
        await expect(page.locator('text=level2')).not.toBeVisible();

        // Simulate reload without skip_restore
        await page.goto('/');

        // Wait for restoration
        await expect(page.locator('text=level1')).toBeVisible();

        // Verify level1 is collapsed immediately after load
        await expect(page.locator('text=level2')).not.toBeVisible();

        // Expand level1
        await page.click('text=level1');

        // Verify level2 is visible and expanded (children visible)
        await expect(page.locator('text=level2')).toBeVisible();
        await expect(page.locator('text=level3')).toBeVisible();

        // Verify level3 is visible but collapsed (children NOT visible)
        // deep_file should still be hidden
        await expect(page.locator('text=deep_file.adoc')).not.toBeVisible();
    });

});
