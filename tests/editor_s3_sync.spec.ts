
import { test, expect, helpers } from './fixtures';
import { loadInitialDirectory, openContextMenu } from './helpers/sidebar_helpers';
import { getDirectoryItem, getSyncItemByPath } from './helpers/locators';
import { SyncContentAction } from '../src/store/S3SyncLogic';

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

test('should upload new local file to S3', async ({ page, fsSetup }) => {
    // 1. Setup: Create a local file
    fsSetup.createFile('s3-project', 'new-file.txt', 'Hello S3');

    // 2. Inject Mock S3 Client (empty remote state)
    await helpers.injectMockS3Client(page, { versions: [] });

    // 3. Load directory
    await loadInitialDirectory(page, 's3-project');

    // 4. Trigger Sync
    const rootItem = getDirectoryItem(page, '');
    await openContextMenu(page, rootItem);
    await page.getByTestId('ctx-s3-sync').click();

    // 5. Verify Sync UI opens and shows the new file
    await expect(page.getByTestId('s3sync-title-bar')).toBeVisible();
    await expect(page.getByTestId('s3sync-sidebar')).toBeVisible();

    // Check for the file item in the sync list
    const fileItem = getSyncItemByPath(page, 'new-file.txt');
    await expect(fileItem).toBeVisible();
    await expect(fileItem).toHaveAttribute('data-content-action', SyncContentAction.CopyLocalToRemote);

    // 6. Execute Sync
    await page.getByTestId('sync-go-button').click();

    // 7. Verify Completion
    // wait for the success message or for the list to update (mock returns empty list after sync if we don't update it, 
    // but here we just want to verify the command was sent)

    // Wait a bit for async operations (using a poll on the calls would be better, but let's wait for UI change first)
    // After success, valid sync items might disappear or status might change. 
    // Since our mock is "dumb" and doesn't update its internal state based on Puts, 
    // the re-scan might still show it as new or error out depending on logic.
    // However, we just need to verify the PutObject call.

    // Let's retry asserting the calls until they appear
    await expect.poll(async () => {
        const calls = await helpers.getMockS3Calls(page);
        return calls.some(c => c.command === 'PutObjectCommand' && c.input.Key === 'test-prefix/new-file.txt');
    }, { timeout: 5000 }).toBe(true);

    const calls = await helpers.getMockS3Calls(page);
    const putCall = calls.find(c => c.command === 'PutObjectCommand' && c.input.Key === 'test-prefix/new-file.txt');
    expect(putCall).toBeDefined();
    expect(putCall?.input.Bucket).toBe('test-bucket');
});
