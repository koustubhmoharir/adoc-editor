
import type { EditorStore } from '../store/EditorStore';
import type { FileSystemStore } from '../store/FileSystemStore';
import type * as monaco from 'monaco-editor';
import type { Dialog } from '../components/Dialog';

declare global {
    interface Window {
        __TEST_ENABLE_GLOBALS?: boolean;
        __TEST_ENABLE_TRACE_LOGGING?: boolean;
        __TEST_editorStore: EditorStore;
        __TEST_fileSystemStore: FileSystemStore;
        __TEST_monaco?: typeof monaco;
        __TEST_dialog: Dialog;
        __TEST_DISABLE_AUTO_SAVE?: boolean;
        __TEST_hydrateHandle?: (handle: any) => any;
        __TEST_mockDirPickerDirName?: string;
        __TEST_mockFilePickerLastCallOptions?: OpenFilePickerOptions | null;
        __TEST_mockFilePickerFilePath?: string | null;
    }

}
