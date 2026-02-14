import { test, expect, helpers } from './fixtures';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers';
import { getDirectoryItem, getSyncItemByPath } from './helpers/locators';
import { SyncContentAction } from '../src/store/S3SyncLogic';
import { Page } from '@playwright/test';

test.beforeEach(async ({ fsSetup }) => {
    fsSetup.cleanup();
    // Setup directory with s3sync.toml

    fsSetup.createFile('s3-project', '.adoc-editor/s3sync.toml', `
bucket = "test-bucket"
region = "us-east-1"
identity_pool_id = "test-pool"
authority = "test-auth"
client_id = "test-client"
prefix = "test-prefix"
        `);
});

async function loadDirectoryAndEnterSyncMode(page: Page) {
    // Load directory
    await loadInitialDirectory(page, 's3-project');

    // Trigger Sync
    const rootItem = getDirectoryItem(page, '');
    await openContextMenu(page, rootItem);
    await page.getByTestId('ctx-s3-sync').click();

    // Verify Sync UI opens and shows the new file
    await expect(page.getByTestId('s3sync-title-bar')).toBeVisible();
    await expect(page.getByTestId('s3sync-sidebar')).toBeVisible();
}

async function completeSync(page: Page) {
    // Prepared to handle the "Sync Complete" dialog
    const dialogHandle = await helpers.handleNextDialog(page);

    // Execute Sync
    await page.getByTestId('sync-go-button').click();

    // Wait for dialog
    // Sync might take a bit longer on first run or CI
    const message = await dialogHandle.getMessage(15000);
    expect(message).toContain('Sync complete');
}

test('should upload new local file to S3', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create a local file
    fsSetup.createFile('s3-project', 'new-file.txt', 'Hello S3');

    // 2. Inject Mock S3 Client (empty remote state)
    // s3Setup is already injected by fixture, we just need to seed it if needed.
    // By default it is empty.
    s3Setup.seed([]);

    await loadDirectoryAndEnterSyncMode(page);

    // Check for the file item in the sync list
    const fileItem = getSyncItemByPath(page, 'new-file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    await completeSync(page);
    
    // Verify Upload in Mock S3
    const uploaded = s3Setup.getLatestVersion('test-prefix/new-file.txt');
    expect(uploaded).toBeDefined();
    expect(uploaded?.content.toString('utf-8')).toBe('Hello S3');
    expect(uploaded?.isLatest).toBe(true);
});
