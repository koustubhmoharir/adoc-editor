import { observable, action, computed, runInAction, reaction } from 'mobx';
import * as monaco from 'monaco-editor';
import { EffectAwareModel } from './EffectAwareModel';
import { DiffViewMode, FileSyncStatus } from './S3SyncLogic';
import type { S3SyncStore } from './S3SyncStore';

export class S3SyncDiffStore extends EffectAwareModel {

    constructor(syncStore: S3SyncStore) {
        super();
        this._syncStore = syncStore;
    }

    private readonly _syncStore: S3SyncStore;

    @observable private accessor _syncItem: FileSyncStatus | null = null;
    get syncItem() { return this._syncItem; }

    // Content loaded from files
    @observable accessor baseContent: string | null = null;
    @observable accessor localContent: string | null = null;
    @observable accessor remoteContent: string | null = null;

    // Current view mode
    @observable accessor currentView: DiffViewMode | null = null;

    // Loading state
    @observable accessor isLoading: boolean = false;

    // Pane sizes (percentage for 3-way view)
    @observable accessor singlePaneHeight: number = 50;

    readonly singleEditorRef = (current: HTMLDivElement) => {
        if (current) {
            this.initializeSingleEditor(current);
        }
        else {
            this._singleEditor?.dispose();
            this._singleEditor = null;
        }
    };
    readonly diffEditorRef = (current: HTMLDivElement) => {
        if (current) {
            this.initializeDiffEditor(current);
        }
        else {
            this._diffEditor?.dispose();
            this._diffEditor = null;
        }
    };

    // Editor instances - managed by store
    private _singleEditor: monaco.editor.IStandaloneCodeEditor | null = null;
    private _diffEditor: monaco.editor.IDiffEditor | null = null;
    private _monacoDisposables: monaco.IDisposable[] = [];
    private _reactionDisposers: (() => void)[] = [];

    // Computed: whether to show single pane
    @computed
    get showSinglePane(): boolean {
        if (!this.currentView) return false;
        return this.currentView.startsWith('single-') || this.currentView === '3way';
    }

    // Computed: whether to show diff pane
    @computed
    get showDiffPane(): boolean {
        if (!this.currentView) return false;
        return this.currentView === 'base-local' ||
            this.currentView === 'base-remote' ||
            this.currentView === 'remote-local' ||
            this.currentView === '3way';
    }

    // Computed: content for single pane (read-only)
    @computed
    get singlePaneContent(): string | null {
        switch (this.currentView) {
            case 'single-base':
            case '3way':
                return this.baseContent;
            case 'single-local':
                return this.localContent;
            case 'single-remote':
                return this.remoteContent;
            default:
                return null;
        }
    }

    // Computed: original content for diff (left side, read-only)
    @computed
    get diffOriginalContent(): string | null {
        switch (this.currentView) {
            case 'base-local':
            case 'base-remote':
                return this.baseContent;
            case 'remote-local':
            case '3way':
                return this.remoteContent;
            default:
                return null;
        }
    }

    // Computed: modified content for diff (right side, editable if local)
    @computed
    get diffModifiedContent(): string | null {
        switch (this.currentView) {
            case 'base-local':
            case 'remote-local':
            case '3way':
                return this.localContent;
            case 'base-remote':
                return this.remoteContent;
            default:
                return null;
        }
    }

    // Computed: whether the diff modified side is editable (only when local)
    @computed
    get isDiffModifiedEditable(): boolean {
        return this.currentView === 'base-local' ||
            this.currentView === 'remote-local' ||
            this.currentView === '3way';
    }

    @action
    async loadContent(item: FileSyncStatus | null) {
        this.isLoading = true;
        this.baseContent = null;
        this.localContent = null;
        this.remoteContent = null;

        try {
            // Load local content
            if (item.local) {
                try {
                    const file = await item.local.handle.getFile();
                    const content = await file.text();
                    runInAction(() => { this.localContent = content; });
                } catch (e) {
                    console.error('Failed to load local content', e);
                }
            }

            // Load base content from .adoc-editor/s3/base directory
            if (item.base) {
                try {
                    const baseContent = await this.loadBaseContent(item.base.key);
                    runInAction(() => { this.baseContent = baseContent; });
                } catch (e) {
                    console.error('Failed to load base content', e);
                }
            }

            // Load remote content from S3 (now passes full record for versioned fetch)
            if (item.remote) {
                try {
                    const remoteContent = await this._syncStore.s3Store.getObjectContent(this._syncStore.directoryNode.handle, item.remote);
                    runInAction(() => { this.remoteContent = remoteContent; });
                } catch (e) {
                    console.error('Failed to load remote content', e);
                }
            }

            // Set default view based on available content
            runInAction(() => {
                const views = item.availableDiffViews;
                if (views.length > 0) {
                    if (views.includes('3way')) {
                        this.currentView = '3way';
                    } else if (views.includes('remote-local')) {
                        this.currentView = 'remote-local';
                    } else if (views.includes('base-local')) {
                        this.currentView = 'base-local';
                    } else if (views.includes('base-remote')) {
                        this.currentView = 'base-remote';
                    } else {
                        this.currentView = views[0] as DiffViewMode;
                    }
                } else {
                    this.currentView = null;
                }
            });
        } finally {
            runInAction(() => { this.isLoading = false; });
        }
    }

    /**
     * Initialize editors with container refs. Called from component.
     */
    @action.bound
    initializeSingleEditor(container: HTMLDivElement) {
        if (this._singleEditor) return;

        this._singleEditor = monaco.editor.create(container, {
            value: '',
            readOnly: true,
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
        });

        // React to content changes
        this._reactionDisposers.push(
            reaction(
                () => this.singlePaneContent,
                (content) => {
                    if (this._singleEditor && this.showSinglePane) {
                        this._singleEditor.setValue(content || '');
                    }
                },
                { fireImmediately: true }
            )
        );
    }

    @action.bound
    initializeDiffEditor(container: HTMLDivElement) {
        if (this._diffEditor) return;

        this._diffEditor = monaco.editor.createDiffEditor(container, {
            automaticLayout: true,
            readOnly: false,
            renderSideBySide: true,
            originalEditable: false,
        });

        // React to content changes
        this._reactionDisposers.push(
            reaction(
                () => ({
                    original: this.diffOriginalContent,
                    modified: this.diffModifiedContent,
                    editable: this.isDiffModifiedEditable,
                    show: this.showDiffPane,
                }),
                ({ original, modified, editable, show }) => {
                    if (this._diffEditor && show) {
                        const originalModel = monaco.editor.createModel(original || '', 'plaintext');
                        const modifiedModel = monaco.editor.createModel(modified || '', 'plaintext');

                        this._diffEditor.setModel({
                            original: originalModel,
                            modified: modifiedModel,
                        });

                        const modifiedEditor = this._diffEditor.getModifiedEditor();
                        modifiedEditor.updateOptions({ readOnly: !editable });

                        // Listen for changes to sync back
                        if (editable) {
                            const disposable = modifiedEditor.onDidChangeModelContent(() => {
                                this.updateLocalContent(modifiedEditor.getValue());
                            });
                            // Store for cleanup on next update
                            this._monacoDisposables.push(disposable);
                        }
                    }
                },
                { fireImmediately: true }
            )
        );
    }

    @action.bound
    dispose() {
        this._reactionDisposers.forEach(d => d());
        this._reactionDisposers = [];
        this._monacoDisposables.forEach(d => d.dispose());
        this._monacoDisposables = [];
        this._singleEditor?.dispose();
        this._singleEditor = null;
        this._diffEditor?.dispose();
        this._diffEditor = null;
    }

    @action.bound
    setView(mode: DiffViewMode) {
        this.currentView = mode;
    }

    @action.bound
    setSinglePaneHeight(height: number) {
        this.singlePaneHeight = Math.max(10, Math.min(90, height));
    }

    @action.bound
    updateLocalContent(content: string) {
        this.localContent = content;
    }

    /**
     * Load base content from .adoc-editor/s3/base directory
     */
    private async loadBaseContent(key: string): Promise<string | null> {
        const rootNode = this._syncStore.directoryNode;
        const prefix = this._syncStore.s3Store.settings.prefix || '';

        // Get relative path from the key
        const relativePath = key.startsWith(prefix) ? key.substring(prefix.length) : key;

        // Navigate to .adoc-editor/s3/base/<relativePath>
        const basePath = `.adoc-editor/s3/base/${relativePath}`;

        try {
            // Try to get the file handle from the root directory
            const handle = await this.getFileHandle(rootNode.handle, basePath);
            if (handle) {
                const file = await handle.getFile();
                return await file.text();
            }
        } catch (e) {
            console.error(`Failed to load base content for ${basePath}`, e);
        }
        return null;
    }

    /**
     * Navigate to a file by path and get its handle
     */
    private async getFileHandle(rootHandle: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle | null> {
        const parts = path.split('/').filter(p => p.length > 0);
        let currentDir = rootHandle;

        for (let i = 0; i < parts.length - 1; i++) {
            try {
                currentDir = await currentDir.getDirectoryHandle(parts[i]);
            } catch {
                return null;
            }
        }

        try {
            return await currentDir.getFileHandle(parts[parts.length - 1]);
        } catch {
            return null;
        }
    }
}
