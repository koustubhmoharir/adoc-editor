import { test, expect } from '@playwright/test';
import { FsTestSetup } from './helpers/fs_test_setup';

test.describe('Search Functionality', () => {
    let fsSetup: FsTestSetup;

    test.beforeEach(async ({ page }) => {
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
        await page.goto('/?skip_restore=true');

        // Wait for Monaco
        await page.waitForFunction(() => (window as any).__TEST_monaco !== undefined, null, { timeout: 10000 });

        // Open folder
        await page.click('button:has-text("Open Folder")');
        // Wait for tree to populate
        await expect(page.locator('text=file-01.adoc')).toBeVisible();
    });

    test.afterEach(() => {
        fsSetup.cleanup();
    });

    test('UI Compatibility: Toggling search', async ({ page }) => {
        // Initially search input hidden
        await expect(page.locator('input[placeholder="Search files..."]')).not.toBeVisible();

        // Toggle on
        await page.click('button[title="Search files"]');
        await expect(page.locator('input[placeholder="Search files..."]')).toBeVisible();
        await expect(page.locator('input[placeholder="Search files..."]')).toBeFocused();

        // Toggle off via button - actually toggle button usually toggles visibility
        await page.click('button[title="Search files"]');
        await expect(page.locator('input[placeholder="Search files..."]')).not.toBeVisible();
    });

    test('Filtering Logic', async ({ page }) => {
        await page.click('button[title="Search files"]');

        // Search "apple"
        await page.fill('input[placeholder="Search files..."]', 'apple');
        await expect(page.locator('text=apple.adoc')).toBeVisible();
        await expect(page.locator('text=banana.adoc')).not.toBeVisible();

        // Search "file"
        await page.fill('input[placeholder="Search files..."]', 'file');
        await expect(page.locator('text=file-01.adoc')).toBeVisible();
        await expect(page.locator('text=file-30.adoc')).toBeVisible();
        await expect(page.locator('text=apple.adoc')).not.toBeVisible();
    });

    test('Scrolling & Navigation', async ({ page }) => {
        await page.click('button[title="Search files"]');
        await page.fill('input[placeholder="Search files..."]', 'file');

        // Locate results
        const resultItems = page.locator('[class*="Sidebar_searchResultItem"]');
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
        await expect(page.locator('input[placeholder="Search files..."]')).toBeFocused(); // If implementation sets focus

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
        const scrollTop = await page.evaluate(() => {
            return document.querySelector('[class*="Sidebar_sidebar"]')?.scrollTop;
        });
        // Or specific container if strictly defined. 
        // Sidebar usually is the scroll container.
        // Actually, sidebar has overflow-y: auto.
        // But let's check input visibility which implies top.
        await expect(page.locator('input[placeholder="Search files..."]')).toBeInViewport();
    });

    test('Interaction & Selection', async ({ page }) => {
        await page.click('button[title="Search files"]');
        await page.fill('input[placeholder="Search files..."]', 'apple');

        // Select via Enter
        await page.keyboard.press('ArrowDown'); // Highlight apple.adoc
        await page.keyboard.press('Enter');

        // Check file opened
        await expect(page.locator('header')).toContainText('apple.adoc');
        // Search should close
        await expect(page.locator('input[placeholder="Search files..."]')).not.toBeVisible();

        // Select via Click
        await page.click('button[title="Search files"]');
        await page.fill('input[placeholder="Search files..."]', 'banana');
        await page.click('text=banana.adoc');

        await expect(page.locator('header')).toContainText('banana.adoc');
        await expect(page.locator('input[placeholder="Search files..."]')).not.toBeVisible();
    });

    test('Clear/Close Logic', async ({ page }) => {
        await page.click('button[title="Search files"]');
        const input = page.locator('input[placeholder="Search files..."]');
        const clearBtn = page.locator('button[title="Clear search"], button[title="Close search"]').first();
        // Since title changes dynamically, selector needs care.

        // 1. Close when empty via Esc
        await expect(input).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(input).not.toBeVisible();

        // 2. Clear when text via Esc
        await page.click('button[title="Search files"]');
        await page.fill('input[placeholder="Search files..."]', 'foo');
        await page.keyboard.press('Escape');
        await expect(input).toHaveValue('');
        await expect(input).toBeVisible();

        // 3. Clear when text via Button
        await page.fill('input[placeholder="Search files..."]', 'bar');
        // Button should verify title "Clear search"
        await expect(page.locator('button[title="Clear search"]')).toBeVisible();
        await page.click('button[title="Clear search"]');
        await expect(input).toHaveValue('');
        await expect(input).toBeVisible();

        // 4. Close when empty via Button
        // Button should verify title "Close search"
        await expect(page.locator('button[title="Close search"]')).toBeVisible();
        await page.click('button[title="Close search"]');
        await expect(input).not.toBeVisible();
    });
});
