import { observable, action, computed, runInAction } from 'mobx';
import * as monaco from 'monaco-editor';
import { EffectAwareModel } from './EffectAwareModel';
import { DiffViewMode, FileSyncStatus, getFileAtPath } from './S3SyncLogic';
import type { S3SyncStore } from './S3SyncStore';
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

    // Content loaded from files
    @observable private accessor _baseContent: string | null = null;
    @observable private accessor _localContent: string | null = null;
    @observable private accessor _remoteContent: string | null = null;

    // Current view mode
    @observable private accessor _currentView: DiffViewMode | null = null;
    get currentView() { return this._currentView; }

    @observable private accessor _showSinglePane = false;
    get showSinglePane() { return this._showSinglePane; }

    @observable private accessor _singlePaneLabel = '';
    get singlePaneLabel() { return this._singlePaneLabel; }

    @observable private accessor _showDiffPane = false;
    get showDiffPane() { return this._showDiffPane; }

    @observable private accessor _diffPaneLabel = '';
    get diffPaneLabel() { return this._diffPaneLabel; }

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

    private _monacoDisposables: monaco.IDisposable[] = [];

    // Computed: content for single pane (read-only)
    @computed
    get singlePaneContent(): string | null {
        switch (this.currentView) {
            case 'single-base':
            case '3way':
                return this._baseContent;
            case 'single-local':
                return this._localContent;
            case 'single-remote':
                return this._remoteContent;
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
                return this._baseContent;
            case 'remote-local':
            case '3way':
                return this._remoteContent;
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
                return this._localContent;
            case 'base-remote':
                return this._remoteContent;
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
        this._isLoading = true;
        this._syncItem = item;

        let baseContent: string | null = null;
        let localContent: string | null = null;
        let remoteContent: string | null = null;

        if (item?.local) {
            try {
                const file = await item.local.handle.getFile();
                localContent = await file.text();
            } catch (e) {
                console.error('Failed to load local content', e);
            }
        }

        if (item?.base) {
            try {
                baseContent = await this.loadBaseContent(item.base.key);
            } catch (e) {
                console.error('Failed to load base content', e);
            }
        }

        if (item?.remote) {
            try {
                remoteContent = await this._syncStore.s3Store.getObjectContentAsText(this._syncStore.directoryNode.handle, item.remote, { cachedOnly: true });
            } catch (e) {
                console.error('Failed to load remote content', e);
            }
        }

        runInAction(() => {
            this._baseContent = baseContent;
            this._localContent = localContent;
            this._remoteContent = remoteContent;
            this._isLoading = false;
            if (item) {
                this.setView(item.availableDiffViews[0]);
            }
        });
    }

    @action.bound
    initializeSingleEditor() {
        if (!this._syncItem || !this.singleEditorRef.current) return;

        let value;
        let langId;
        if (this._currentView === '3way' || this._currentView === 'single-base') {
            value = this._baseContent;
            langId = langIdFromFileName(this._syncItem.base!.key);
        }
        else if (this._currentView === 'single-local') {
            value = this._localContent;
            langId = langIdFromFileName(this._syncItem.local!.key);
        }
        else if (this._currentView === 'single-remote') {
            value = this._remoteContent;
            langId = langIdFromFileName(this._syncItem.remote!.key);
        }
        else {
            value = null;
            langId = 'plaintext';
        }
        this._singleEditor = monaco.editor.create(this.singleEditorRef.current, {
            value: value ?? '',
            language: langId,
            readOnly: this._currentView !== 'single-local',
            automaticLayout: true,
            minimap: { enabled: false },
            wordWrap: 'on'
        });
    }

    @action.bound
    initializeDiffEditor() {
        if (!this.syncItem || !this.diffEditorRef.current) return;

        let originalContent;
        let modifiedContent;
        let langId;
        if (this._currentView === '3way' || this._currentView === 'remote-local') {
            originalContent = this._remoteContent;
            modifiedContent = this._localContent;
            langId = langIdFromFileName(this.syncItem.local?.handle.name ?? '');
        }
        else if (this._currentView === 'base-local') {
            originalContent = this._baseContent;
            modifiedContent = this._localContent;
            langId = langIdFromFileName(this.syncItem.local?.handle.name ?? '');
        }
        else if (this._currentView === 'base-remote') {
            originalContent = this._baseContent;
            modifiedContent = this._remoteContent;
            langId = langIdFromFileName(this.syncItem.remote?.key ?? '');
        }
        else {
            return;
        }

        const originalModel = monaco.editor.createModel(originalContent!, langId);
        const modifiedModel = monaco.editor.createModel(modifiedContent!, langId);

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
        this._monacoDisposables.forEach(d => d.dispose());
        this._monacoDisposables = [];
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
            this._singlePaneLabel = mode.substring('single-'.length);
            this._diffPaneLabel = '';
        }
        else if (mode === '3way') {
            this._showSinglePane = true;
            this._showDiffPane = true;
            this._singlePaneLabel = 'base';
            this._diffPaneLabel = 'remote-local';
        }
        else {
            this._showSinglePane = false;
            this._showDiffPane = true;
            this._singlePaneLabel = '';
            this._diffPaneLabel = mode;
        }
        this.scheduleEffect(() => {
            this._disposeSingleEditor();
            this._disposeDiffEditor();
            if (this.showSinglePane) {
                this.initializeSingleEditor();
            }
            if (this.showDiffPane) {
                this.initializeDiffEditor();
            }
        });
    }

    @action.bound
    setSinglePaneHeight(height: number) {
        this.singlePaneHeight = Math.max(10, Math.min(90, height));
    }

    @action.bound
    updateLocalContent(content: string) {
        this._localContent = content;
    }

    /**
     * Load base content from .s3/base directory
     */
    private async loadBaseContent(key: string): Promise<string | null> {
        const rootNode = this._syncStore.directoryNode;
        const prefix = this._syncStore.s3Store.settings.prefix || '';

        // Get relative path from the key
        const relativePath = key.startsWith(prefix) ? key.substring(prefix.length) : key;

        // Try to get the file handle from the root directory
        const handle = await getFileAtPath(rootNode.handle, `.adoc-editor/s3b/${relativePath}`);
        const file = await handle.getFile();
        return await file.text();
    }
}
