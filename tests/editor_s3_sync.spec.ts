import { test, expect, helpers } from './fixtures';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers';
import { getDirectoryItem, getFileItem, getSyncItemByPath } from './helpers/locators';
import { SyncContentAction } from '../src/store/S3SyncLogic';
import { Page } from '@playwright/test';

test.beforeEach(async ({ fsSetup, s3Setup }) => {
    s3Setup.cleanup();
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

test.afterEach(async ({ page }) => {
    if (await page.getByTestId('exit-sync-button').isVisible()) {
        await page.getByTestId('exit-sync-button').click();
    }
})

async function loadDirectoryAndEnterSyncMode(page: Page) {
    // If in Sync Mode, exit first
    if (await page.getByTestId('exit-sync-button').isVisible()) {
        await page.getByTestId('exit-sync-button').click();
    }
    else {
        // Load directory
        await loadInitialDirectory(page, 's3-project');
    }

    // Trigger Sync
    const rootItem = getDirectoryItem(page, '');
    await openContextMenu(page, rootItem);
    await page.getByTestId('ctx-s3-sync').click();

    // Verify Sync UI opens and shows the new file
    await expect(page.getByTestId('s3sync-title-bar')).toBeVisible();
    await expect(page.getByTestId('s3sync-sidebar')).toBeVisible();
}

async function completeSync(page: Page, expectedMessage: string = 'Sync complete') {
    // Prepared to handle the "Sync Complete" dialog
    const dialogHandle = await helpers.handleNextDialog(page);

    // Execute Sync
    await page.getByTestId('sync-go-button').click();

    // Wait for dialog
    // Sync might take a bit longer on first run or CI
    const message = await dialogHandle.getMessage(15000);
    expect(message).toContain(expectedMessage);
}

// 1. Setup: Create a local file
test('should upload new local file to S3', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create a local file
    fsSetup.createFile('s3-project', 'new-file.txt', 'Hello S3');

    // 2. Inject Mock S3 Client (empty remote state)
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

test('should upload local changes to S3', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create a local file and sync it to establish base state
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // fsSetup.createFile overwrites in the mock FS.
    fsSetup.createFile('s3-project', 'file.txt', 'Version 2');

    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const fileItem = getSyncItemByPath(page, 'file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    await completeSync(page);

    // Verify Upload
    const uploaded = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(uploaded?.content.toString('utf-8')).toBe('Version 2');
});

test('should download remote changes to local', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create local file and sync
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    const record = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(record).toBeDefined();
    // 2. Update remote file, metadata must be set to avoid conflict in next sync
    s3Setup.addTextVersion('test-prefix/file.txt', 'Version 2', { syncVersion: 2, uuid: record!.metadata['uuid'] });

    // 3. Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const fileItem = getSyncItemByPath(page, 'file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    await completeSync(page);

    // Verify Local File Content
    const content = fsSetup.readFile('s3-project', 'file.txt');
    expect(content).toBe('Version 2');
});

test('should do nothing when content is identical', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Sync Again without changes
    await loadDirectoryAndEnterSyncMode(page);

    // If it appears, action should be None.
    const fileItems = page.getByTestId('sync-item');
    const count = await fileItems.count();
    if (count > 0) {
        // If items are visible, ensure action is None
        const fileItem = getSyncItemByPath(page, 'file.txt');
        if (await fileItem.isVisible()) {
            await expect(fileItem).toHaveAttribute('data-content-action', 'None');
        }
    }

    await completeSync(page, "No actionable items selected");
});

test('should delete remote file when local file is deleted', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Delete Me');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Delete local file
    // To delete a file mid-test, we should use the UI or evaluate script.

    await page.getByTestId('exit-sync-button').click();
    const fileItem = getFileItem(page, 'file.txt');
    await openContextMenu(page, fileItem);

    // Handle confirmation dialog for delete
    const dialogHandle = await helpers.handleNextDialog(page, true);
    await page.getByTestId('ctx-delete').click();
    await dialogHandle.getMessage(); // Wait for dialog to be handled

    await expect(fileItem).not.toBeVisible();

    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteRemote);

    await completeSync(page);

    // Verify Remote Delete
    const latest = s3Setup.getLatestVersion('test-prefix/file.txt');
    // If deleted, it might be gone or have delete marker. 
    // MockS3Client doesn't strictly implement DeleteMarkers visibly in getLatestVersion unless we check internals.
    // But getLatestVersion returns undefined if no latest version (or if all are not latest).
    // Actually `handleDeleteObject` sets `isLatest=false` on all versions. 
    // So `getLatestVersion` should return undefined.
    expect(latest).toBeUndefined();
});

test('should delete local file when remote file is deleted', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Delete Me');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Delete remote file
    await s3Setup.deleteObject('test-prefix/file.txt');

    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteLocal);

    await completeSync(page);

    // Verify delete
    expect(fsSetup.exists('s3-project', 'file.txt')).toEqual(false);
});

test('should download new remote file', async ({ page, fsSetup, s3Setup }) => {

    // Required to ensure this root directory exists even if it does not contain anything
    fsSetup.createDirectory('s3-project', '');

    s3Setup.seed([]);
    s3Setup.addTextVersion('test-prefix/remote-only.txt', 'I am from S3');

    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'remote-only.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    await completeSync(page);

    const content = fsSetup.readFile('s3-project', 'remote-only.txt');
    expect(content).toBe('I am from S3');
});
