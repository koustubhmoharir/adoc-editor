import { observable, action, runInAction } from 'mobx';
import * as monaco from 'monaco-editor';
import { EffectAwareModel } from './EffectAwareModel';
import { DiffViewMode, FileSyncStatus, getBaseFileHandle, loadRemoteFileFromCache } from './S3SyncLogic';
import type { S3SyncStore } from './S3SyncStore';
import { isBinaryFile } from './FileSystemHelpers';
import { createRef } from 'react';
import { langIdFromFileName } from './EditorStore';

export class S3SyncDiffStore extends EffectAwareModel {

    constructor(syncStore: S3SyncStore) {
        super();
        this._syncStore = syncStore;
    }

    private readonly _syncStore: S3SyncStore;
    get syncStore() { return this._syncStore; }
    get prefix() { return this._syncStore.s3Store.settings.prefix; }

    @observable private accessor _syncItem: FileSyncStatus | null = null;
    get syncItem() { return this._syncItem; }

    private _isBaseBinary = false;
    private _isLocalBinary = false;
    private _isRemoteBinary = false;
    private _isRemoteDownloaded = false;

    // Content loaded from files
    private _baseContent: string | null = null;
    private _localContent: string | null = null;
    private _remoteContent: string | null = null;

    // Current view mode
    @observable private accessor _currentView: DiffViewMode | null = null;
    get currentView() { return this._currentView; }

    private _showSinglePane = false;

    @observable.ref private accessor _singlePaneDetails: Readonly<{
        isBinary: boolean;
        content: string | null;
        langId: string | null;
        loadBinary: () => void;
        download?: () => void;
    }> | null = null;
    get singlePaneDetails() { return this._singlePaneDetails; }

    private _showDiffPane = false;

    @observable.ref private accessor _diffPaneDetails: Readonly<{
        isBinary: boolean;
        originalContent: string | null;
        modifiedContent: string | null;
        langId: string | null;
        loadBinary: () => void;
        download?: () => void;
    }> | null = null;
    get diffPaneDetails() { return this._diffPaneDetails; }

    // Loading state
    @observable private accessor _isLoading = false;
    get isLoading() { return this._isLoading; }

    // Pane sizes (percentage for 3-way view)
    @observable accessor singlePaneHeight: number = 50;

    readonly singleEditorRef = createRef<HTMLDivElement>();
    readonly diffEditorRef = createRef<HTMLDivElement>();

    // Editor instances - managed by store
    private _singleEditor: monaco.editor.IStandaloneCodeEditor | null = null;
    private _disposeSingleEditor() {
        if (this._singleEditor) {
            this._singleEditor.dispose();
            this._singleEditor = null;
        }
    }

    private _diffEditor: monaco.editor.IDiffEditor | null = null;
    private _disposeDiffEditor() {
        if (this._diffEditor) {
            this._diffEditor.dispose();
            this._diffEditor = null;
        }
    }

    @action
    async loadContent(item: FileSyncStatus | null) {
        this._isLoading = true;
        this._syncItem = item;

        await this._loadLocalContent(false);

        await this._loadBaseContent(false);

        await this._loadRemoteContent(false);

        runInAction(() => {
            this._isLoading = false;
            if (item) {
                this.setView(item.availableDiffViews[0]);
            }
            else {
                this._showSinglePane = false;
                this._singlePaneDetails = null;
                this._showDiffPane = false;
                this._diffPaneDetails = null;
                this._disposeSingleEditor();
                this._disposeDiffEditor();
            }
        });
    }

    @action.bound
    private async _downloadRemoteContent() {
        if (!this.syncItem?.remote) return;
        this._isLoading = true;
        try {
            const handle = await this._syncStore.s3Store.ensureRemoteCached(this._syncStore.directoryNode.handle, this.syncItem.remote);
            if (handle) {
                this._isRemoteDownloaded = true;
                const file = await handle.getFile();
                this._isRemoteBinary = await isBinaryFile(file);
                this._remoteContent = this._isRemoteBinary ? null : await file.text();
                // TODO: Calculate hash and save in metadata cache
            }
            else {
                this._isRemoteDownloaded = false;
                this._isRemoteBinary = false;
                this._remoteContent = null;
            }
        } catch (e) {
            console.error("Failed to download remote content", e);
        } finally {
            runInAction(() => {
                this._isLoading = false;
                this._refreshView(false);
            });
        }
    }

    private _wrapLoader(loader: () => Promise<void>) {
        return action(async () => {
            this._isLoading = true;
            try {
                await loader();
            } finally {
                runInAction(() => {
                    this._refreshView(false);
                    this._isLoading = false;
                });
            }
        });
    }

    private async _loadLocalContent(forceText: boolean) {
        if (this.syncItem?.local) {
            const file = await this.syncItem.local.handle.getFile();
            this._isLocalBinary = forceText ? false : await isBinaryFile(file);
            this._localContent = this._isLocalBinary ? null : await file.text();
        }
        else {
            this._isLocalBinary = false;
            this._localContent = null;
        }
    }

    private async _loadBaseContent(forceText: boolean) {
        if (this.syncItem?.base) {
            const handle = await getBaseFileHandle(this._syncStore.directoryNode.handle, this.syncItem.base.key, this.prefix);
            const file = await handle!.getFile();
            this._isBaseBinary = forceText ? false : await isBinaryFile(file);
            this._baseContent = this._isBaseBinary ? null : await file.text();
        }
        else {
            this._isBaseBinary = false;
            this._baseContent = null;
        }
    }

    private async _loadRemoteContent(forceText: boolean) {
        if (this.syncItem?.remote) {
            const relativePath = this.syncItem.remote.key.substring(this.prefix.length);
            const cachedHandle = await loadRemoteFileFromCache(this._syncStore.directoryNode.handle, relativePath, this.syncItem!.remote!.version);
            if (cachedHandle) {
                this._isRemoteDownloaded = true;
                const file = await cachedHandle.getFile();
                this._isRemoteBinary = forceText ? false : await isBinaryFile(file);
                this._remoteContent = this._isRemoteBinary ? null : await file.text();
                return;
            }
        }
        this._isRemoteDownloaded = false;
        this._isRemoteBinary = false;
        this._remoteContent = null;
    }

    private _refreshView(dispose: boolean) {
        this._singlePaneDetails = null;
        if (this._showSinglePane && this._syncItem) {
            if (this._currentView === '3way' || this._currentView === 'single-base') {
                this._singlePaneDetails = {
                    content: this._baseContent,
                    langId: langIdFromFileName(this._syncItem.base!.key),
                    isBinary: this._isBaseBinary,
                    loadBinary: this._wrapLoader(async () => { await this._loadBaseContent(true); })
                }
            }
            else if (this._currentView === 'single-local') {
                this._singlePaneDetails = {
                    content: this._localContent,
                    langId: langIdFromFileName(this._syncItem.local!.key),
                    isBinary: this._isLocalBinary,
                    loadBinary: this._wrapLoader(async () => { await this._loadLocalContent(true); })
                }
            }
            else if (this._currentView === 'single-remote') {
                this._singlePaneDetails = {
                    content: this._remoteContent,
                    langId: langIdFromFileName(this._syncItem.remote!.key),
                    isBinary: this._isRemoteBinary,
                    loadBinary: this._wrapLoader(async () => { await this._loadRemoteContent(true); }),
                    download: this._isRemoteDownloaded ? undefined : this._downloadRemoteContent
                }
            }
        }
        this._diffPaneDetails = null;
        if (this._showDiffPane && this._syncItem) {
            if (this._currentView === '3way' || this._currentView === 'remote-local') {
                this._diffPaneDetails = {
                    originalContent: this._remoteContent,
                    modifiedContent: this._localContent,
                    langId: langIdFromFileName(this._syncItem.local?.handle.name ?? ''),
                    isBinary: this._isRemoteBinary || this._isLocalBinary,
                    loadBinary: this._wrapLoader(async () => {
                        if (this._isLocalBinary) { await this._loadLocalContent(true); }
                        if (this._isRemoteBinary) { await this._loadRemoteContent(true); }
                    }),
                    download: this._isRemoteDownloaded ? undefined : this._downloadRemoteContent
                };
            }
            else if (this._currentView === 'base-local') {
                this._diffPaneDetails = {
                    originalContent: this._baseContent,
                    modifiedContent: this._localContent,
                    langId: langIdFromFileName(this._syncItem.local?.handle.name ?? ''),
                    isBinary: this._isBaseBinary || this._isLocalBinary,
                    loadBinary: this._wrapLoader(async () => {
                        if (this._isLocalBinary) { await this._loadLocalContent(true); }
                        if (this._isBaseBinary) { await this._loadBaseContent(true); }
                    }),
                };
            }
            else if (this._currentView === 'base-remote') {
                this._diffPaneDetails = {
                    originalContent: this._baseContent,
                    modifiedContent: this._remoteContent,
                    langId: langIdFromFileName(this._syncItem.remote?.key ?? ''),
                    isBinary: this._isRemoteBinary || this._isBaseBinary,
                    loadBinary: this._wrapLoader(async () => {
                        if (this._isRemoteBinary) { await this._loadRemoteContent(true); }
                        if (this._isBaseBinary) { await this._loadBaseContent(true); }
                    }),
                    download: this._isRemoteDownloaded ? undefined : this._downloadRemoteContent
                };
            }
        }
        this.scheduleEffect(() => {
            if (dispose) {
                this._disposeSingleEditor();
                this._disposeDiffEditor();
            }
            this.initializeSingleEditor();
            this.initializeDiffEditor();
        });
    }

    @action.bound
    initializeSingleEditor() {
        if (!this._singlePaneDetails || !this.singleEditorRef.current || this._singleEditor) return;

        if (this._singlePaneDetails.content != null) {
            this._singleEditor = monaco.editor.create(this.singleEditorRef.current, {
                value: this._singlePaneDetails.content,
                language: this._singlePaneDetails.langId!,
                readOnly: this._currentView !== 'single-local',
                automaticLayout: true,
                minimap: { enabled: false },
                wordWrap: 'on'
            });
        }
    }

    @action.bound
    initializeDiffEditor() {
        if (!this._diffPaneDetails || !this.diffEditorRef.current || this._diffEditor) return;

        const originalModel = monaco.editor.createModel(this._diffPaneDetails.originalContent!, this._diffPaneDetails.langId!);
        const modifiedModel = monaco.editor.createModel(this._diffPaneDetails.modifiedContent!, this._diffPaneDetails.langId!);

        this._diffEditor = monaco.editor.createDiffEditor(this.diffEditorRef.current, {
            readOnly: this._currentView !== '3way' && !this._currentView?.endsWith('-local'),
            automaticLayout: true,
            renderSideBySide: true,
            originalEditable: false,
            wordWrap: 'on'
        });
        this._diffEditor.setModel({
            original: originalModel,
            modified: modifiedModel,
        });
    }

    @action.bound
    dispose() {
        this._disposeSingleEditor();
        this._disposeDiffEditor();
    }

    @action.bound
    setView(mode: DiffViewMode) {
        this._currentView = mode;
        this._showSinglePane = mode.startsWith('single-') || mode === '3way';
        if (mode.startsWith('single-')) {
            this._showSinglePane = true;
            this._showDiffPane = false;
        }
        else if (mode === '3way') {
            this._showSinglePane = true;
            this._showDiffPane = true;
        }
        else {
            this._showSinglePane = false;
            this._showDiffPane = true;
        }
        this._refreshView(true);
    }

    @action.bound
    setSinglePaneHeight(height: number) {
        this.singlePaneHeight = Math.max(10, Math.min(90, height));
    }
}
