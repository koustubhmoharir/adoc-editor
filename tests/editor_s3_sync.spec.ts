import { test, expect, helpers } from './fixtures';
import { completeRename, loadInitialDirectory, openContextMenu, triggerRename } from './helpers/sidebar_helpers';
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
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Hello Nested S3');

    // 2. Inject Mock S3 Client (empty remote state)
    s3Setup.seed([]);

    await loadDirectoryAndEnterSyncMode(page);

    // Check for the file item in the sync list
    const fileItem = getSyncItemByPath(page, 'new-file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    const nestedItem = getSyncItemByPath(page, 'subdir/nested.txt');
    await expect(nestedItem).toBeVisible();
    await expect(nestedItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    await completeSync(page);

    // Verify Upload in Mock S3
    const uploaded = s3Setup.getLatestVersion('test-prefix/new-file.txt');
    expect(uploaded).toBeDefined();
    expect(uploaded?.content.toString('utf-8')).toBe('Hello S3');
    expect(uploaded?.isLatest).toBe(true);

    const uploadedNested = s3Setup.getLatestVersion('test-prefix/subdir/nested.txt');
    expect(uploadedNested).toBeDefined();
    expect(uploadedNested?.content.toString('utf-8')).toBe('Hello Nested S3');
    expect(uploadedNested?.isLatest).toBe(true);
});

test('should upload local changes to S3', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create a local file and sync it to establish base state
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Nested Version 1');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // fsSetup.createFile overwrites in the mock FS.
    fsSetup.createFile('s3-project', 'file.txt', 'Version 2');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Nested Version 2');

    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const fileItem = getSyncItemByPath(page, 'file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    const nestedItem = getSyncItemByPath(page, 'subdir/nested.txt');
    await expect(nestedItem).toBeVisible();
    await expect(nestedItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    await completeSync(page);

    // Verify Upload
    const uploaded = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(uploaded?.content.toString('utf-8')).toBe('Version 2');

    const uploadedNested = s3Setup.getLatestVersion('test-prefix/subdir/nested.txt');
    expect(uploadedNested?.content.toString('utf-8')).toBe('Nested Version 2');
});

test('should download remote changes to local', async ({ page, fsSetup, s3Setup }) => {
    // 1. Setup: Create local file and sync
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Nested Version 1');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    const record = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(record).toBeDefined();
    const nestedRecord = s3Setup.getLatestVersion('test-prefix/subdir/nested.txt');
    expect(nestedRecord).toBeDefined();

    // 2. Update remote file, metadata must be set to avoid conflict in next sync
    s3Setup.addTextVersion('test-prefix/file.txt', 'Version 2', { syncVersion: 2, uuid: record!.metadata['uuid'] });
    s3Setup.addTextVersion('test-prefix/subdir/nested.txt', 'Nested Version 2', { syncVersion: 2, uuid: nestedRecord!.metadata['uuid'] });

    // 3. Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const fileItem = getSyncItemByPath(page, 'file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    const nestedItem = getSyncItemByPath(page, 'subdir/nested.txt');
    await expect(nestedItem).toBeVisible();
    await expect(nestedItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    await completeSync(page);

    // Verify Local File Content
    const content = fsSetup.readFile('s3-project', 'file.txt');
    expect(content).toBe('Version 2');
    const nestedContent = fsSetup.readFile('s3-project', 'subdir/nested.txt');
    expect(nestedContent).toBe('Nested Version 2');
});

test('should do nothing when content is identical', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Version 1');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Nested Version 1');
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
        const nestedItem = getSyncItemByPath(page, 'subdir/nested.txt');
        if (await nestedItem.isVisible()) {
            await expect(nestedItem).toHaveAttribute('data-content-action', 'None');
        }
    }

    await completeSync(page, "No actionable items selected");
});

test('should delete remote file when local file is deleted', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Delete Me');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Delete Nested Me');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Delete local file
    // To delete a file mid-test, we should use the UI or evaluate script.

    await page.getByTestId('exit-sync-button').click();

    // Delete root file
    const fileItem = getFileItem(page, 'file.txt');
    await openContextMenu(page, fileItem);
    let dialogHandle = await helpers.handleNextDialog(page, true);
    await page.getByTestId('ctx-delete').click();
    await dialogHandle.getMessage();
    await expect(fileItem).not.toBeVisible();

    // Delete nested file
    // Need to expand directory? It should be expanded if we just synced? 
    // Actually sidebar logic might collapse or not.
    // Let's ensure subdir is visible.
    const dirItem = getDirectoryItem(page, 'subdir');
    // If it's collapsed, expand it. But we access by data-file-path which works if visible.
    // If directory is collapsed, children are not in DOM.
    // Check if subdir is present.
    await expect(dirItem).toBeVisible();
    // Assuming it is expanded or we can find it.
    // Let's expand just in case.
    if (await dirItem.getAttribute('aria-expanded') === 'false') {
        await dirItem.click();
    }

    const nestedFileItem = getFileItem(page, 'subdir/nested.txt');
    await openContextMenu(page, nestedFileItem);
    dialogHandle = await helpers.handleNextDialog(page, true);
    await page.getByTestId('ctx-delete').click();
    await dialogHandle.getMessage();
    await expect(nestedFileItem).not.toBeVisible();


    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteRemote);

    const nestedSyncItem = getSyncItemByPath(page, 'subdir/nested.txt');
    await expect(nestedSyncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteRemote);

    await completeSync(page);

    // Verify Remote Delete
    const latest = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(latest).toBeUndefined();

    const latestNested = s3Setup.getLatestVersion('test-prefix/subdir/nested.txt');
    expect(latestNested).toBeUndefined();
});

test('should delete local file when remote file is deleted', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Delete Me');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Delete Nested Me');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Delete remote file
    await s3Setup.deleteObject('test-prefix/file.txt');
    await s3Setup.deleteObject('test-prefix/subdir/nested.txt');

    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteLocal);

    const nestedSyncItem = getSyncItemByPath(page, 'subdir/nested.txt');
    await expect(nestedSyncItem).toHaveAttribute('data-content-action', SyncContentAction.DeleteLocal);

    await completeSync(page);

    // Verify delete
    expect(fsSetup.exists('s3-project', 'file.txt')).toEqual(false);
    expect(fsSetup.exists('s3-project', 'subdir/nested.txt')).toEqual(false);
});

test('should download new remote file', async ({ page, fsSetup, s3Setup }) => {

    // Required to ensure this root directory exists even if it does not contain anything
    fsSetup.createDirectory('s3-project', '');

    s3Setup.seed([]);
    s3Setup.addTextVersion('test-prefix/remote-only.txt', 'I am from S3');
    s3Setup.addTextVersion('test-prefix/subdir/nested-remote.txt', 'I am nested from S3');

    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'remote-only.txt');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    const nestedSyncItem = getSyncItemByPath(page, 'subdir/nested-remote.txt');
    await expect(nestedSyncItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    await completeSync(page);

    const content = fsSetup.readFile('s3-project', 'remote-only.txt');
    expect(content).toBe('I am from S3');

    const nestedContent = fsSetup.readFile('s3-project', 'subdir/nested-remote.txt');
    expect(nestedContent).toBe('I am nested from S3');
});

test('should preserve UUID when renaming local file', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Rename Me');
    fsSetup.createFile('s3-project', 'subdir/nested.txt', 'Rename Nested Me');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // 1. Rename local root file
    await page.getByTestId('exit-sync-button').click();

    const fileItem = getFileItem(page, 'file.txt');
    const input = await triggerRename(page, fileItem);
    await completeRename(page, input, 'renamed-file.txt', 'enter');

    // 2. Rename local nested file
    // Need to expand directory first if not visible (it should be visible from initial load)
    const nestedItem = getFileItem(page, 'subdir/nested.txt'); 
    const nestedInput = await triggerRename(page, nestedItem);
    await completeRename(page, nestedInput, 'renamed-nested.txt', 'enter');


    // Sync Again
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'renamed-file.txt');
    await expect(syncItem).toBeVisible();

    // Should be UseLocalPath (implied rename) and None (implied content match)
    await expect(syncItem).toHaveAttribute('data-path-action', 'UseLocalPath');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.None);

    const nestedSyncItem = getSyncItemByPath(page, 'subdir/renamed-nested.txt');
    await expect(nestedSyncItem).toBeVisible();
    await expect(nestedSyncItem).toHaveAttribute('data-path-action', 'UseLocalPath');
    await expect(nestedSyncItem).toHaveAttribute('data-content-action', SyncContentAction.None);

    await completeSync(page);

    // Verify Remote State
    const oldRemote = s3Setup.getLatestVersion('test-prefix/file.txt');
    expect(oldRemote).toBeUndefined();

    const newRemote = s3Setup.getLatestVersion('test-prefix/renamed-file.txt');
    expect(newRemote).toBeDefined();
    expect(newRemote?.content.toString('utf-8')).toBe('Rename Me');

    const oldNestedRemote = s3Setup.getLatestVersion('test-prefix/subdir/nested.txt');
    expect(oldNestedRemote).toBeUndefined();

    const newNestedRemote = s3Setup.getLatestVersion('test-prefix/subdir/renamed-nested.txt');
    expect(newNestedRemote).toBeDefined();
    expect(newNestedRemote?.content.toString('utf-8')).toBe('Rename Nested Me');
});

test('should rename local file when remote file is renamed', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Move Me');
    s3Setup.seed([]);

    // Initial Sync to establish UUID
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Get UUID from remote
    const remoteVersion = s3Setup.getLatestVersion('test-prefix/file.txt');
    const uuid = remoteVersion?.metadata?.uuid;
    expect(uuid).toBeDefined();

    // Simulate Remote Rename: Delete old, add new with SAME UUID
    await s3Setup.deleteObject('test-prefix/file.txt');
    s3Setup.addTextVersion('test-prefix/renamed-remote.txt', 'Move Me', { uuid });

    // Sync Again
    await page.getByTestId('exit-sync-button').click();
    await loadDirectoryAndEnterSyncMode(page);

    // Note: The UI currently displays the item using the local path if it exists.
    // So we look for 'file.txt' but expect the action to be UseRemotePath (rename to renamed-remote.txt)
    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toBeVisible();

    // Should be UseRemotePath (implied rename) and None (content match)
    await expect(syncItem).toHaveAttribute('data-path-action', 'UseRemotePath');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.None);

    await completeSync(page);

    // Verify Local State
    await page.getByTestId('exit-sync-button').click();

    // Check old file gone
    await expect(getFileItem(page, 'file.txt')).not.toBeVisible();

    // Check new file present
    await expect(getFileItem(page, 'renamed-remote.txt')).toBeVisible();
    const content = fsSetup.readFile('s3-project', 'renamed-remote.txt');
    expect(content).toBe('Move Me');
});

test('should move local file when remote file is moved', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Move Me To Subdir');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Get UUID
    const remoteVersion = s3Setup.getLatestVersion('test-prefix/file.txt');
    const uuid = remoteVersion?.metadata?.uuid;

    // Simulate Remote Move
    await s3Setup.deleteObject('test-prefix/file.txt');
    s3Setup.addTextVersion('test-prefix/subdir/moved.txt', 'Move Me To Subdir', { uuid, syncVersion: 1 });

    // Sync
    await page.getByTestId('exit-sync-button').click();
    await loadDirectoryAndEnterSyncMode(page);

    // Expected item is at local path 'file.txt'
    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toBeVisible();
    await expect(syncItem).toHaveAttribute('data-path-action', 'UseRemotePath');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.None);

    await completeSync(page);
    await page.getByTestId('exit-sync-button').click();

    // Verify Local
    const root = getDirectoryItem(page, '');
    await root.click();
    await expect(root).toHaveAttribute('data-selected', 'true');
    await page.keyboard.press('F5');
    
    await expect(getFileItem(page, 'file.txt')).not.toBeVisible();

    await expect(getFileItem(page, 'subdir/moved.txt')).toBeVisible();
});

test('should rename local file and update content when remote file is renamed and changed', async ({ page, fsSetup, s3Setup }) => {
    fsSetup.createFile('s3-project', 'file.txt', 'Original Content');
    s3Setup.seed([]);

    // Initial Sync
    await loadDirectoryAndEnterSyncMode(page);
    await completeSync(page);

    // Get UUID
    const remoteVersion = s3Setup.getLatestVersion('test-prefix/file.txt');
    const uuid = remoteVersion?.metadata?.uuid;
    const syncVersion = parseInt(remoteVersion?.metadata?.syncversion || '0', 10);

    // Simulate Remote Rename + Change
    await s3Setup.deleteObject('test-prefix/file.txt');
    s3Setup.addTextVersion('test-prefix/renamed-changed.txt', 'New Content', { uuid, syncVersion: syncVersion + 1 });

    // Sync
    await page.getByTestId('exit-sync-button').click();
    await loadDirectoryAndEnterSyncMode(page);

    const syncItem = getSyncItemByPath(page, 'file.txt');
    await expect(syncItem).toBeVisible();

    // Should be UseRemotePath (rename) AND CopyRemoteToLocal (content change)
    await expect(syncItem).toHaveAttribute('data-path-action', 'UseRemotePath');
    await expect(syncItem).toHaveAttribute('data-content-action', SyncContentAction.CopyRemoteToLocal);

    await completeSync(page);

    // Verify Local
    await page.getByTestId('exit-sync-button').click();
    await expect(getFileItem(page, 'file.txt')).not.toBeVisible();

    await expect(getFileItem(page, 'renamed-changed.txt')).toBeVisible();
    const content = fsSetup.readFile('s3-project', 'renamed-changed.txt');
    expect(content).toBe('New Content');
});
