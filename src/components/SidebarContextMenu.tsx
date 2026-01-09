import { observer } from 'mobx-react-lite';
import { fileSystemStore } from '../store/FileSystemStore';
// Using inline styles for now as vanilla-extract issues with newer CSS properties like anchor-name/position-anchor inside keyframes or complex selectors might arise, 
// and typescript support for them is cutting edge. But we can put basic styles in CSS and positioning in style tag.
import * as styles from './Sidebar.css';
import { closeOnClick, useUpDownFocusNavigationInPopover } from '../hooks/useUpDownFocusNavigation';


// @ts-ignore
export const SidebarContextMenu = observer(() => {

    const targetNode = fileSystemStore.contextMenuTarget;

    const ref = fileSystemStore.contextMenuRef;
    useUpDownFocusNavigationInPopover(ref, fileSystemStore.onContextMenuClosed)

    return (
        <div
            ref={ref}
            // @ts-ignore
            popover="auto"
            // @ts-ignore
            //onToggle={handleToggle}
            className={styles.contextMenu}
            style={targetNode ? undefined : { display: 'none' }}
            data-testid="sidebar-contextmenu"
            tabIndex={-1} // Allow focus
            onClick={closeOnClick}
        >
            {targetNode?.kind === 'file' && (
                <>
                    <button className={styles.contextMenuItem} onClick={() => {
                        fileSystemStore.selectNode(targetNode, 'focus');
                    }} data-testid="ctx-open">
                        <i className={`fas fa-external-link-alt ${styles.contextMenuIcon}`} />
                        Open
                    </button>
                    <button className={styles.contextMenuItem} onClick={() => {
                        targetNode.startRenaming();
                    }} data-testid="ctx-rename">
                        <i className={`fas fa-pencil-alt ${styles.contextMenuIcon}`} />
                        Rename
                    </button>
                    <button className={styles.contextMenuItem} onClick={() => {
                        targetNode.delete();
                    }} data-testid="ctx-delete">
                        <i className={`fas fa-trash-alt ${styles.contextMenuIcon}`} />
                        Delete
                    </button>
                </>
            )}

            {targetNode?.kind === 'directory' && (
                <>
                    <button className={styles.contextMenuItem} onClick={() => {
                        fileSystemStore.createNewFile(targetNode.handle as FileSystemDirectoryHandle);
                    }} data-testid="ctx-new-file">
                        <i className={`fas fa-file-circle-plus ${styles.contextMenuIcon}`} />
                        New File
                    </button>
                </>
            )}
        </div>
    );
});
