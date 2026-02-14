import { test, expect } from './fixtures';
import { loadInitialDirectory } from './helpers/sidebar_helpers';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    fsSetup.createFile('dir1', 'short.txt', 'content');
    fsSetup.createFile('dir1', 'very_long_file_name_that_should_be_truncated_in_the_sidebar_view.txt', 'content');
});

test('should be resizable', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    // Class name might need adjustment or use a better selector
    // Better to target by structure since class names are hashed if vanilla-extract is used without debug ids
    // But I can add a data-testid to the sidebar container in my implementation.
    // For now, I'll assume I will add data-testid="sidebar"
    const sidebarContainer = page.getByTestId('sidebar');

    // Initial width
    const initialBox = await sidebarContainer.boundingBox();
    expect(initialBox).not.toBeNull();
    const initialWidth = initialBox!.width;

    // Find resize handle
    const handle = page.getByTestId('sidebar-resize-handle');
    await expect(handle).toBeVisible();

    // Drag handle
    const handleBox = await handle.boundingBox();
    expect(handleBox).not.toBeNull();

    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + 100, handleBox!.y + handleBox!.height / 2); // Move 100px right
    await page.mouse.up();

    // New width
    const newBox = await sidebarContainer.boundingBox();
    expect(newBox!.width).toBeGreaterThan(initialWidth);
    // Should be approximately initial + 100
    expect(newBox!.width).toBeCloseTo(initialWidth + 100, -1); // approximate
});

test('should show tooltip for file items', async ({ page }) => {
    await loadInitialDirectory(page, 'dir1');

    const longFileName = 'very_long_file_name_that_should_be_truncated_in_the_sidebar_view.txt';
    const fileItem = page.locator(`[data-file-path="${longFileName}"]`);

    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('title', longFileName);

    const textSpan = fileItem.locator('span').first();
    // Note: The file item might have icon + text, where text is in span. 
    // But some implementations might have multiple spans?
    // In my current Sidebar.tsx, it is <i> and <span>. So locator('span') is safe.
    // Wait, for directory it might be different, but this test is for file.

    await expect(textSpan).toHaveCSS('text-overflow', 'ellipsis');
    await expect(textSpan).toHaveCSS('overflow', 'hidden');
    await expect(textSpan).toHaveCSS('white-space', 'nowrap');
});
