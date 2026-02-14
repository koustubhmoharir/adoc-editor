import { test as base, Page, expect, BrowserContext, Browser } from '@playwright/test';
import { FsTestSetup } from './helpers/fs_test_setup.ts'; // Explicit .ts to match project style


interface DialogHandle {
    getMessage: () => Promise<string>;
}

interface DialogResult {
    message: string;
    actionFound: boolean;
}

type DialogResolversQueue = ((result: DialogResult) => void)[];

interface PageGlobalState {
    dialogResolversQueue: DialogResolversQueue;
    defaultDialogTitle: string;
}

// Equivalent of a module-level variable on the Playwright side (node)
// dialogResolversQueue stores pending handlers that we have created but have not yet fulfilled by the browser.
// It needs to be maintained per page and reset when the page refreshes.
const pageGlobalState: WeakMap<Page, PageGlobalState> = new WeakMap();
function getOrCreatePageState(page: Page) {
    let pageState = pageGlobalState.get(page);
    if (pageState == null) {
        pageState = { dialogResolversQueue: [], defaultDialogTitle: '' };
        pageGlobalState.set(page, pageState);

        page.on("framenavigated", frame => {
            if (frame === page.mainFrame()) {
                pageGlobalState.set(page, { dialogResolversQueue: [], defaultDialogTitle: '' });
            }
        });
    }
    return pageState;
}

function getPageState(page: Page) {
    const pageState = pageGlobalState.get(page);
    if (!pageState) throw new Error('waitForTestGlobals was not called');
    return pageState
}

async function enableTestGlobals(page: Page) {

    function onDialogHandled(message: string, actionFound: boolean) {
        const queue = getOrCreatePageState(page).dialogResolversQueue;
        const resolve = queue.shift();
        if (resolve) {
            resolve({ message, actionFound });
        } else {
            console.warn('onDialogHandled called but no handler was waiting in the queue.');
        }
    }

    // Expose the handler function to the browser context
    await page.exposeFunction('__TEST_onDialogHandled', onDialogHandled);

    await page.addInitScript(() => {
        window.__TEST_ENABLE_GLOBALS = true;
        const dialogActionsQueue: (boolean | null)[] = [];
        let dialogInterval: number | null = null;

        (window as any).__TEST_scheduleDialogAction = (action: boolean | null) => {
            dialogActionsQueue.push(action);

            // Start the watcher loop only if not already running
            if (dialogInterval) return;

            dialogInterval = window.setInterval(() => {
                const dialog = window.__TEST_dialog;

                // Stop if queue empty
                if (dialogActionsQueue.length === 0) {
                    if (dialogInterval != null) {
                        clearInterval(dialogInterval);
                        dialogInterval = null;
                    }
                    return;
                }

                // If dialog is open and we have a pending action
                if (dialog.isOpen) {
                    const action = dialogActionsQueue.shift(); // Get next action

                    // Capture message via DOM for consistency
                    const msgEl = document.querySelector('[data-testid="dialog-message"]');
                    const message = msgEl ? msgEl.textContent : '';

                    // Perform action
                    let btnSelector = '';

                    if (action === true) {
                        btnSelector = '[data-testid="dialog-result-true"]';
                    } else if (action === false) {
                        btnSelector = '[data-testid="dialog-result-false"]';
                    } else {
                        btnSelector = '[data-testid="dialog-result-null"]';
                    }

                    const btn = document.querySelector(btnSelector) as HTMLButtonElement | null;
                    if (btn) {
                        btn.click();
                        // Notify Playwright
                        (window as any).__TEST_onDialogHandled(message, true);
                    } else {
                        // Notify Playwright that we failed to find the button
                        (window as any).__TEST_onDialogHandled(message, false);
                    }
                }
            }, 50);
        };

        (window as any).__TEST_checkDialogState = () => {
            const dialog = window.__TEST_dialog;
            const isDialogOpen = dialog ? dialog.isOpen : false;
            return dialogActionsQueue.length === 0 && !isDialogOpen;
        };
    });
}

async function waitForTestGlobals(page: Page) {
    await page.waitForFunction(() => {
        return window.__TEST_ENABLE_GLOBALS === true && window.__TEST_monaco !== undefined && window.__TEST_dialog !== undefined;
    });
    getOrCreatePageState(page).defaultDialogTitle = await page.evaluate(() => {
        return window.__TEST_dialog.defaultTitle
    });
}

/**
 * Enables test logging in the browser context.
 * Captures console logs (error, warning, and generic logs if DEBUG_TESTS is set)
 * and forwards them to the Node.js console.
 * Also listens for page errors and re-throws them to fail the test.
 * 
 * @param page - The Playwright Page object.
 */
function enableTestLogging(page: Page) {
    page.on('pageerror', err => { throw err; });
    page.on('console', msg => {
        const t = msg.type();
        if (t === 'error') {
            console.error(`BROWSER: ${msg.text()}`);
        }
        else if (t === 'warning') {
            console.warn(`BROWSER: ${msg.text()}`);
        }
        else if (process.env.DEBUG_TESTS) {
            console.log(`BROWSER: ${msg.text()}`);
        }
    });
    if (process.env.DEBUG_TESTS) {
        page.on('dialog', async dialog => {
            console.warn(`DIALOG: ${dialog.type()} "${dialog.message()}"`);
            console.warn(`Modify the application code to use dialog.alert and dialog.confirm instead of native dialogs.`);
            dialog.dismiss();
        });
    }
}

export const helpers = {
    /**
     * Retrieves the default title of the dialog from the page state.
     * @param page - The Playwright Page object.
     * @returns The default dialog title.
     */
    defaultDialogTitle(page: Page) {
        return getPageState(page).defaultDialogTitle;
    },

    /**
     * Programs the browser to automatically handle the next dialog that appears.
     * @param page The Playwright page.
     * @param action The action to perform (true for Confirm/Yes, false for No, null for Cancel). Defaults to true.
     * @returns An object with a getMessage() method.
     */
    async handleNextDialog(page: Page, action: boolean | null = true): Promise<DialogHandle> {
        const resultPromise = new Promise<DialogResult>(resolve => {
            // Add the resolver to a queue
            // This will be called when onDialogHandled is called
            getOrCreatePageState(page).dialogResolversQueue.push(resolve);
        });

        // Schedule the action in the browser
        await page.evaluate((act) => {
            (window as any).__TEST_scheduleDialogAction(act);
        }, action);

        return {
            getMessage: async (timeoutInMilliseconds = 5000) => {
                const timeoutPromise = new Promise<DialogResult>((_, reject) =>
                    setTimeout(() => reject(new Error("Dialog action was expected but the dialog callback was never invoked. This usually means the action did not trigger a dialog as expected.")), timeoutInMilliseconds)
                );
                const result = await Promise.race([resultPromise, timeoutPromise]);

                if (!result.actionFound) {
                    throw new Error("The expected button was not found on the dialog. This usually means the action did not trigger a dialog at all or triggered dialog.alert when dialog.confirm was expected.");
                }
                return result.message;
            }
        };
    },

    /**
     * Sets up a new page for testing.
     * - Enables test logging.
     * - Registers file system mocks.
     * - Enables test globals (window.__TEST_*).
     * - Navigates to the initial page.
     * - Waits for globals to be ready.
     * 
     * @param page - The Playwright Page object.
     * @param fsSetup - The file system setup helper.
     */
    async setupNewPage(page: Page, fsSetup: FsTestSetup) {
        // Setup environment
        enableTestLogging(page);
        await fsSetup.register(page);
        await enableTestGlobals(page);

        // Navigate once per worker
        await page.goto('/?skip_restore=true', { waitUntil: "domcontentloaded" });
        await waitForTestGlobals(page);
    },

    /**
     * Reloads the current page.
     * Use this if you need to refresh the application state completely.
     * 
     * @param page - The Playwright Page object.
     * @param options - Navigation options.
     * @param options.path - The path to navigate to (default: '/').
     * @param options.skipRestore - Whether to skip restoring the previous directory handle (default: true).
     */
    async reloadPage(page: Page, { path, skipRestore }: { path?: string, skipRestore?: boolean } = { path: '/', skipRestore: true }): Promise<void> {
        await flushPendingDbOperations(page);
        await page.goto((path ?? '/') + ((skipRestore ?? true) ? '?skip_restore=true' : ''), { waitUntil: "domcontentloaded" });
        await waitForTestGlobals(page);
    },

    /**
     * Sets the choice for the mock directory picker.
     * When the application calls showDirectoryPicker, it will receive a handle to this directory.
     * 
     * @param page - The Playwright Page object.
     * @param dirName - The name of the directory to simulate selection for.
     * It corresponds to the dirName argument of the methods in the FsTestSetup class.
     * It must be the name of the directory, not a path. It cannot contain a directory separator.
     */
    async setDirectoryPickerChoice(page: Page, dirName: string): Promise<void> {
        await page.evaluate((dirName) => {
            window.__TEST_mockDirPickerDirName = dirName;
        }, dirName);
    },

    /**
     * Sets the choice for the mock file picker.
     * When the application calls showOpenFilePicker, it will receive a handle to this file.
     * 
     * @param page - The Playwright Page object.
     * @param filePath - The full path (relative to mock FS root) of the file. Or null to simulate proper cancellation.
     * For a file in a directory, it should be dirName/relativePath
     * For an external file, it should be /fileName
     */
    async setFilePickerChoice(page: Page, filePath: string | null): Promise<void> {
        await page.evaluate((filePath) => {
            window.__TEST_mockFilePickerFilePath = filePath;
        }, filePath);
    },

    /**
     * Disables the auto-save mechanism in the editor.
     * Useful for tests where you want to manually control saving or avoid race conditions.
     * 
     * @param page - The Playwright Page object.
     */
    async disableAutoSave(page: Page): Promise<void> {
        await page.evaluate(() => {
            window.__TEST_DISABLE_AUTO_SAVE = true;
        });
    },

    /**
     * Retrieves the current text content of the Monaco editor.
     * 
     * @param page - The Playwright Page object.
     * @returns The content of the editor.
     */
    async getEditorContent(page: Page): Promise<string> {
        return await page.evaluate(() => window.__TEST_editorStore.getContent());
    },

    /**
     * Replaces the editor content by simulating user typing.
     * This triggers all standard keyboard events and editor behaviors (like auto-closing brackets).
     * CAUTION: This will NOT work properly if a mock clock is installed, as Monaco uses async workers.
     * Use setEditorContentDirect instead when using fake timers.
     * 
     * @param page - The Playwright Page object.
     * @param content - The text to type.
     */
    async replaceEditorContentByTyping(page: Page, content: string): Promise<void> {
        // Click the editor to focus it
        await page.click('.monaco-editor');
        await page.keyboard.press('Control+A');
        // Type the new content
        await page.keyboard.type(content);
    },

    /**
     * Sets the content of the Monaco editor directly using the store.
     * This is faster than typing and avoids keyboard interaction issues when clock is mocked.
     * 
     * @param page - The Playwright Page object.
     * @param content - The new content to set.
     */
    async setEditorContentDirect(page: Page, content: string): Promise<void> {
        return page.evaluate(content => {
            const editor = window.__TEST_editorStore.editor;
            const model = editor?.getModel();
            if (!editor || !model) return;
            editor.pushUndoStop();
            editor.executeEdits("replace-all", [
                {
                    range: model.getFullModelRange(),
                    text: content,
                    forceMoveMarkers: true,
                },
            ]);
            editor.pushUndoStop();
        }, content);
    },

    /**
     * Retrieves the current language ID of the editor model.
     * 
     * @param page - The Playwright Page object.
     * @returns The language ID (e.g., 'asciidoc', 'javascript').
     */
    async getEditorLanguageId(page: Page): Promise<string> {
        return page.evaluate(() => {
            return window.__TEST_editorStore.editor?.getModel()?.getLanguageId() ?? '';
        });
    },

    /**
     * Injects a mock S3 client into the browser page context.
     * The mock records all `send()` calls and returns plausible responses.
     * Use `getMockS3Calls` to retrieve the recorded calls for assertions.
     *
     * @param page - The Playwright Page object.
     * @param options - Configuration for initial remote state.
     * @param options.versions - Array of remote versions to pre-populate for ListObjectVersionsCommand.
     */
    async injectMockS3Client(page: Page, options?: {
        versions?: Array<{
            Key: string;
            VersionId: string;
            IsLatest: boolean;
            Size?: number;
            ETag?: string;
            LastModified?: string;
            Metadata?: Record<string, string>;
        }>;
    }): Promise<void> {
        await page.evaluate((opts) => {
            const versions = opts?.versions ?? [];
            const calls: Array<{ command: string; input: any }> = [];
            let nextVersionCounter = 1;

            (window as any).__TEST_mockS3Calls = calls;

            // Identify command type by schema since esbuild minifies constructor names in production bundle.
            function identifyCommand(command: any): string {
                const schemaName = command.schema?.[2] ?? '';
                return `${schemaName}Command`;
            }

            window.__TEST_mockS3Client = {
                send(command: any): Promise<any> {
                    const input = command.input;
                    const name = identifyCommand(command);
                    calls.push({ command: name, input: { ...input, Body: input.Body ? '[body]' : undefined } });

                    switch (name) {
                        case 'ListObjectVersionsCommand':
                            return Promise.resolve({
                                Versions: versions
                                    .filter((v: any) => !input.Prefix || v.Key.startsWith(input.Prefix))
                                    .map((v: any) => ({
                                        Key: v.Key,
                                        VersionId: v.VersionId,
                                        IsLatest: v.IsLatest,
                                        LastModified: v.LastModified ? new Date(v.LastModified) : new Date(),
                                        ETag: v.ETag ?? '"mock-etag"',
                                        Size: v.Size ?? 0,
                                    })),
                                NextKeyMarker: undefined,
                                NextVersionIdMarker: undefined,
                            });

                        case 'HeadObjectCommand': {
                            const v = versions.find((ver: any) =>
                                ver.Key === input.Key &&
                                (!input.VersionId || ver.VersionId === input.VersionId)
                            );
                            if (!v) {
                                const err: any = new Error('NoSuchKey');
                                err.$metadata = { httpStatusCode: 404 };
                                return Promise.reject(err);
                            }
                            return Promise.resolve({
                                VersionId: v.VersionId,
                                Metadata: v.Metadata ?? {},
                                ContentLength: v.Size ?? 0,
                                ETag: v.ETag ?? '"mock-etag"',
                                LastModified: v.LastModified ? new Date(v.LastModified) : new Date(),
                            });
                        }

                        case 'PutObjectCommand': {
                            const vId = `mock-put-version-${nextVersionCounter++}`;
                            return Promise.resolve({
                                VersionId: vId,
                                ETag: '"mock-put-etag"',
                            });
                        }

                        case 'DeleteObjectCommand':
                            return Promise.resolve({
                                DeleteMarker: true,
                                VersionId: `mock-delete-version-${nextVersionCounter++}`,
                            });

                        case 'CopyObjectCommand':
                            return Promise.resolve({
                                VersionId: `mock-copy-version-${nextVersionCounter++}`,
                                CopyObjectResult: {
                                    ETag: '"mock-copy-etag"',
                                    LastModified: new Date(),
                                },
                            });

                        default:
                            return Promise.reject(new Error(`MockS3Client: Unknown command: ${name}`));
                    }
                },
            };
        }, options);
    },

    /**
     * Retrieves the list of S3 commands that were sent to the mock S3 client.
     *
     * @param page - The Playwright Page object.
     * @returns Array of recorded calls with command name and input.
     */
    async getMockS3Calls(page: Page): Promise<Array<{ command: string; input: any }>> {
        return page.evaluate(() => {
            return (window as any).__TEST_mockS3Calls ?? [];
        });
    },
}

interface WorkerState {
    context: BrowserContext;
    page: Page;
    fsSetup: FsTestSetup;
    isDirty: boolean;
    viewport: { width: number; height: number };
}

type WorkerFixture = {
    workerState: WorkerState;
};

type TestFixture = {
    fsSetup: FsTestSetup;
    // We override 'page' so tests get the shared one
};

async function checkDialogState(page: Page): Promise<boolean> {
    const queue = pageGlobalState.get(page)?.dialogResolversQueue;
    const nodeQueueEmpty = !queue || queue.length === 0;

    const browserStateClean = await page.evaluate(() => {
        return (window as any).__TEST_checkDialogState ? (window as any).__TEST_checkDialogState() : true;
    });

    return nodeQueueEmpty && browserStateClean;
}

async function prepareWorkerForTest(browser: Browser, workerState: WorkerState): Promise<void> {
    // Check if dialog state is clean
    const isDialogClean = await checkDialogState(workerState.page);
    if (workerState.isDirty || !isDialogClean) {
        console.warn(`Creating a new context. Dirty: ${workerState.isDirty}, DialogClean: ${isDialogClean}`);
        workerState.context.close();

        workerState.context = await browser.newContext();
        workerState.page = await workerState.context.newPage();
        workerState.isDirty = false;
        await helpers.setupNewPage(workerState.page, workerState.fsSetup);
    }
    else {
        // Reset state before each test
        workerState.page.setViewportSize(workerState.viewport);
        // Reset file system state
        await workerState.page.evaluate(async ({ enableTraceLogging }) => {
            window.localStorage.clear();
            if (window.__TEST_fileSystemStore) {
                await window.__TEST_fileSystemStore.clearDirectory();
            }
            window.__TEST_DISABLE_AUTO_SAVE = false;
            window.__TEST_ENABLE_TRACE_LOGGING = enableTraceLogging;
        }, { enableTraceLogging: !!process.env.DEBUG_TESTS });
    }
}

async function flushPendingDbOperations(page: Page): Promise<void> {
    await page.evaluate(async () => {
        if (window.__TEST_fileSystemStore) {
            await window.__TEST_fileSystemStore.flushPendingDbOperations();
        }
    });
}

export const test = base.extend<TestFixture, WorkerFixture>({
    workerState: [async ({ browser }, use) => {

        const state: WorkerState = {} as any;
        state.context = await browser.newContext();
        state.page = await state.context.newPage();
        state.fsSetup = new FsTestSetup();
        state.isDirty = false;
        state.viewport = state.page.viewportSize()!;

        await helpers.setupNewPage(state.page, state.fsSetup);

        // State object to track dirtiness across tests in this worker
        await use(state);

        // Cleanup after all tests in worker are done
        await state.context.close();
        state.fsSetup.cleanup();
    }, { scope: 'worker' }],

    page: async ({ browser, workerState }, use, testInfo) => {

        await prepareWorkerForTest(browser, workerState);

        await use(workerState.page);

        await flushPendingDbOperations(workerState.page);

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
