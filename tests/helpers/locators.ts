
import { Page, Locator } from '@playwright/test';

export const getFileItem = (page: Page, filePath: string): Locator =>
    page.locator(`[data-testid="file-item"][data-file-path="${filePath}"]`);

export const getDirectoryItem = (page: Page, dirPath: string): Locator =>
    page.locator(`[data-testid="directory-item"][data-dir-path="${dirPath}"]`);

export const getRenameInput = (page: Page): Locator =>
    page.locator('[data-testid="rename-input"]');
