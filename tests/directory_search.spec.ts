import { test, expect } from '@playwright/test';
import { FsTestSetup } from './helpers/fs_test_setup';
import { enableTestLogging } from './helpers/test_logging';
import { waitForMonaco } from './helpers/monaco_helpers';
import { enableTestGlobals } from './helpers/test_globals';

test.describe('Search Functionality', () => {
    let fsSetup: FsTestSetup;

    test.beforeEach(async ({ page }) => {
        enableTestLogging(page);
        fsSetup = new FsTestSetup();

        // 1. Create large set of files for scrolling
        for (let i = 1; i <= 30; i++) {
            const num = i.toString().padStart(2, '0');
            fsSetup.createFile('dir1', `file-${num}.adoc`, `== File ${num}`);
        }

        // 2. Create distinct files for filtering
        fsSetup.createFile('dir1', 'apple.adoc', '== Apple');
        fsSetup.createFile('dir1', 'banana.adoc', '== Banana');
        fsSetup.createFile('dir1', 'cherry.txt', 'Ignored'); // Should not show up in ADOC filter anyway if we filter by extension, but search finds all files provided by store which might include txt if we allow it?
        // Wait, store.allFiles currently recurses everything in directory. 
        // Our file tree logic filters based on some criteria? 
        // FileSystemStore.ts:36 `allFiles` recurses `fileTree`. 
        // Logic in sidebar uses `allFiles`. 
        // If file system returns .txt, it will be in `allFiles`.
        // Let's assume standard behavior: if it's in tree, it's searchable.

        // Set viewport height to 400px to force scrolling
        await page.setViewportSize({ width: 1280, height: 400 });

        await fsSetup.init(page);
        await enableTestGlobals(page);
        await page.goto('/?skip_restore=true');

        // Wait for Monaco
        await waitForMonaco(page);

        // Open folder
        await page.click('[data-testid="open-folder-button"]');
        // Wait for tree to populate
        await expect(page.locator('[data-testid="file-item"]', { hasText: 'file-01.adoc' })).toBeVisible();
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('UI Compatibility: Toggling search', async ({ page }) => {
        // Initially search input hidden
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();

        // Toggle on
        await page.click('[data-testid="search-toggle-button"]');
        await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="search-input"]')).toBeFocused();

        // Toggle off via button - actually toggle button usually toggles visibility
        await page.click('[data-testid="search-toggle-button"]');
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();
    });

    test('Filtering Logic', async ({ page }) => {
        await page.click('[data-testid="search-toggle-button"]');

        // Search "apple"
        await page.fill('[data-testid="search-input"]', 'apple');
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'apple.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'banana.adoc' })).not.toBeVisible();

        // Search "file"
        await page.fill('[data-testid="search-input"]', 'file');
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'file-01.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'file-30.adoc' })).toBeVisible();
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'apple.adoc' })).not.toBeVisible();
    });

    test('Scrolling & Navigation', async ({ page }) => {
        await page.click('[data-testid="search-toggle-button"]');
        await page.fill('[data-testid="search-input"]', 'file');

        // Locate results
        const resultItems = page.locator('[data-testid="search-result-item"]');
        // Wait for results
        await expect(resultItems.first()).toBeVisible();

        // --- Arrow Navigation ---

        // Arrow Down -> Select first
        await page.keyboard.press('ArrowDown');
        await expect(resultItems.nth(0)).toHaveClass(/highlighted/);
        await expect(resultItems.nth(0)).toBeInViewport();

        // Arrow Down -> Select second
        await page.keyboard.press('ArrowDown');
        await expect(resultItems.nth(1)).toHaveClass(/highlighted/);
        await expect(resultItems.nth(0)).not.toHaveClass(/highlighted/);

        // Arrow Up -> Select first
        await page.keyboard.press('ArrowUp');
        await expect(resultItems.nth(0)).toHaveClass(/highlighted/);

        // Arrow Up from first -> Clear highlight, focus input/top
        await page.keyboard.press('ArrowUp');
        await expect(resultItems.nth(0)).not.toHaveClass(/highlighted/);
        // Verify input is still focused or at least visible/accessible
        await expect(page.locator('[data-testid="search-input"]')).toBeFocused(); // If implementation sets focus

        // --- Page Navigation ---

        // Start from -1 (input focused)
        // PageDown -> Should jump down.
        await page.keyboard.press('PageDown');

        // Determine which item is highlighted. 
        // We expect delta > 1. Let's find the highlighted index.
        const firstPageHighlightIndex = await resultItems.evaluateAll(items =>
            items.findIndex(item => item.className.includes('highlighted'))
        );
        expect(firstPageHighlightIndex).toBeGreaterThan(1);
        await expect(resultItems.nth(firstPageHighlightIndex)).toBeInViewport();

        // Repeated PageDown to end
        // We have 30 files. Page size ~400px / ~30px item ~ 10-15 items?
        // Let's press PageDown 5 times to be safe.
        for (let i = 0; i < 5; i++) await page.keyboard.press('PageDown');

        // Should be at last item
        const lastIndex = 29; // file-30
        await expect(resultItems.nth(lastIndex)).toHaveClass(/highlighted/);
        await expect(resultItems.nth(lastIndex)).toBeInViewport();

        // --- Page Up ---

        // Page Up once
        await page.keyboard.press('PageUp');
        const endPageHighlightIndex = await resultItems.evaluateAll(items =>
            items.findIndex(item => item.className.includes('highlighted'))
        );
        expect(endPageHighlightIndex).toBeLessThan(lastIndex - 1);
        await expect(resultItems.nth(endPageHighlightIndex)).toBeInViewport();

        // Repeated Page Up to top
        for (let i = 0; i < 5; i++) await page.keyboard.press('PageUp');

        // Should clear highlight
        const topHighlightIndex = await resultItems.evaluateAll(items =>
            items.findIndex(item => item.className.includes('highlighted'))
        );
        expect(topHighlightIndex).toBe(-1);

        // Check scroll position is 0 (top)
        /* const scrollTop = await page.evaluate(() => {
            return document.querySelector('[class*="Sidebar_sidebar"]')?.scrollTop;
        }); */
        // Or specific container if strictly defined. 
        // Sidebar usually is the scroll container.
        // Actually, sidebar has overflow-y: auto.
        // But let's check input visibility which implies top.
        await expect(page.locator('[data-testid="search-input"]')).toBeInViewport();
    });

    test('Interaction & Selection', async ({ page }) => {
        await page.click('[data-testid="search-toggle-button"]');
        await page.fill('[data-testid="search-input"]', 'apple');

        // Select via Enter
        await page.keyboard.press('ArrowDown'); // Highlight apple.adoc
        await page.keyboard.press('Enter');

        // Check file opened
        await expect(page.locator('[data-testid="current-filename"]')).toHaveText('apple.adoc');
        // Search should close
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();

        // Select via Click
        await page.click('[data-testid="search-toggle-button"]');
        await page.fill('[data-testid="search-input"]', 'banana');
        await page.click('[data-testid="search-result-item"]:has-text("banana.adoc")');

        await expect(page.locator('[data-testid="title-bar"]')).toContainText('banana.adoc');
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();
    });

    test('Clear/Close Logic', async ({ page }) => {
        await page.click('[data-testid="search-toggle-button"]');
        const input = page.locator('[data-testid="search-input"]');
        // We can use data-testid for clear button which serves both roles, but check visibility/function
        const clearBtn = page.locator('[data-testid="clear-search-button"]');

        // 1. Close when empty via Esc
        await expect(input).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(input).not.toBeVisible();

        // 2. Clear when text via Esc
        await page.click('[data-testid="search-toggle-button"]');
        await page.fill('[data-testid="search-input"]', 'foo');
        await page.keyboard.press('Escape');
        await expect(input).toHaveValue('');
        await expect(input).toBeVisible();

        // 3. Clear when text via Button
        await page.fill('[data-testid="search-input"]', 'bar');
        // Button should be visible
        await expect(clearBtn).toBeVisible();
        await clearBtn.click();
        await expect(input).toHaveValue('');
        await expect(input).toBeVisible();

        // 4. Close when empty via Button
        await expect(clearBtn).toBeVisible();
        await clearBtn.click();
        await expect(input).not.toBeVisible();
    });
    test('Keyboard Shortcut (Ctrl + ~)', async ({ page }) => {
        // Toggle on via shortcut
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="search-input"]')).toBeFocused();

        // Type something
        await page.fill('[data-testid="search-input"]', 'apple');
        await expect(page.locator('[data-testid="search-result-item"]', { hasText: 'apple.adoc' })).toBeVisible();

        // Toggle off via shortcut - should clear and close
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();

        // Toggle on again - should be empty
        await page.keyboard.press('Control+Backquote');
        await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="search-input"]')).toHaveValue('');

        // Close for next test
        await page.keyboard.press('Control+Backquote');
    });

    test('Keyboard Shortcut (Meta + ~ for Mac)', async ({ page }) => {
        // Toggle on via shortcut with Meta
        await page.keyboard.press('Meta+Backquote');
        await expect(page.locator('[data-testid="search-input"]')).toBeVisible();
        await expect(page.locator('[data-testid="search-input"]')).toBeFocused();

        // Toggle off via shortcut - should clear and close
        await page.keyboard.press('Meta+Backquote');
        await expect(page.locator('[data-testid="search-input"]')).not.toBeVisible();
    });
});
