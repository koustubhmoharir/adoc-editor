import { test as base, Page, expect, BrowserContext } from '@playwright/test';
import { FsTestSetup } from './helpers/fs_test_setup.ts'; // Explicit .ts to match project style
import { enableTestLogging } from './helpers/test_logging.ts';
import { enableTestGlobals, waitForTestGlobals, checkDialogState } from './helpers/test_globals.ts';
import { waitForMonaco } from './helpers/monaco_helpers.ts';

type WorkerFixture = {
    workerState: {
        context: BrowserContext;
        page: Page;
        fsSetup: FsTestSetup;
        isDirty: boolean;
        viewport: { width: number; height: number };
    };
};

type TestFixture = {
    fsSetup: FsTestSetup;
    // We override 'page' so tests get the shared one
};

export async function setupNewPage(page: Page, fsSetup: FsTestSetup) {
    // Setup environment
    enableTestLogging(page);
    await fsSetup.register(page);
    await enableTestGlobals(page);

    // Navigate once per worker
    await page.goto('/?skip_restore=true', { waitUntil: "domcontentloaded" });
    await waitForTestGlobals(page);
    await waitForMonaco(page);
}

export const test = base.extend<TestFixture, WorkerFixture>({
    workerState: [async ({ browser }, use) => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const fsSetup = new FsTestSetup();

        const viewport = page.viewportSize()!;

        await setupNewPage(page, fsSetup);

        // State object to track dirtiness across tests in this worker
        await use({ context, page, fsSetup, isDirty: false, viewport });

        // Cleanup after all tests in worker are done
        await page.close();
        await context.close();
        fsSetup.cleanup();
    }, { scope: 'worker' }],

    page: async ({ workerState }, use, testInfo) => {
        const { page, viewport } = workerState;

        // Reset state before each test
        page.setViewportSize(viewport);
        await page.evaluate(async () => {
            // Clear LocalStorage
            window.localStorage.clear();
            // clearDirectory also clears IndexedDB
            await window.__TEST_fileSystemStore.clearDirectory();
            // Re-enable AutoSave
            window.__TEST_DISABLE_AUTO_SAVE__ = false;
        });

        // Check if dialog state is clean
        const isDialogClean = await checkDialogState(page);

        if (workerState.isDirty || !isDialogClean) {
            console.log(`Reloading page. Dirty: ${workerState.isDirty}, DialogClean: ${isDialogClean}`);
            await page.reload();
            await waitForTestGlobals(page);
            await waitForMonaco(page);
            workerState.isDirty = false;
        }

        await use(page);

        // Mark as dirty if failed
        if (testInfo.status !== 'passed' && testInfo.status !== 'skipped') {
            workerState.isDirty = true;
        }
    },

    context: async ({ workerState }, use) => {
        await use(workerState.context);
    },

    fsSetup: async ({ workerState }, use) => {
        await use(workerState.fsSetup);
    }
});

export { expect };
