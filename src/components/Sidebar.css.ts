import { style } from '@vanilla-extract/css';
import { vars as themeVars, sidebarWidth } from '../theme.css';

export const sidebar = style({
    width: sidebarWidth,
    height: '100%',
    backgroundColor: themeVars.color.background,
    borderRight: `1px solid ${themeVars.color.border}`,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    fontSize: '14px',
    fontFamily: 'sans-serif',
    position: 'relative'
});

export const emptyState = style({
    padding: '4px 8px',
    color: themeVars.color.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic'
});

export const treeContainer = style({
    paddingBottom: '8px',
    paddingLeft: '8px'
});

export const itemBase = style({
    cursor: 'pointer',
    padding: '4px 8px 4px 0',
    display: 'flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: themeVars.color.text,
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const directoryContainer = style({
    paddingLeft: '12px'
});

export const directoryItem = style([itemBase, {
    fontWeight: 'bold',
    paddingRight: '4px'
}]);

export const fileItem = style([itemBase, {
    position: 'relative',
    marginLeft: '12px',
}]);

export const selected = style({
    backgroundColor: themeVars.color.selectionBackground,
    color: themeVars.color.selectionForeground,
    ':hover': {
        backgroundColor: themeVars.color.selectionBackground,
        color: themeVars.color.selectionForeground
    }
});

export const icon = style({
    flexShrink: 0,
    opacity: 1 // Ensure full opacity for colors
});

export const folderIcon = style([icon, {
    color: themeVars.color.folderIcon,
    margin: '4px',
}]);

export const rootFolderIcon = style([folderIcon, {
    margin: '0 8px 0 0',
}]);

export const fileIcon = style([icon, {
    color: themeVars.color.fileIcon,
    width: '19px',
    marginRight: '4px',
}]);

export const header = style({
    padding: '4px 4px 4px 8px',
    fontWeight: 'bold',
    fontSize: '14px',
    color: themeVars.color.text,
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
    // Handle long names
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    ':hover': {
        color: themeVars.color.text,
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const headerText = style({
    marginRight: '8px',
    textDecoration: 'underline',
});

export const actionButton = style({
    marginTop: '8px',
    backgroundColor: 'transparent',
    border: `1px solid ${themeVars.color.border}`,
    color: themeVars.color.text,
    borderRadius: '4px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontSize: '12px',
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const newFileButton = style({
    marginLeft: 'auto',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: themeVars.color.newFileIcon,
    padding: '0 4px',
    borderRadius: '4px',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0, // Hidden by default
    transition: 'opacity 0.2s',
    selectors: {
        [`${sidebar}:hover &`]: {
            opacity: 1 // Show on hover of parent
        },
    },
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const searchToggleButton = style({
    position: "relative",
    top: "1px",
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    color: themeVars.color.textLight,
    padding: '0 4px',
    borderRadius: '4px',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const searchContainer = style({
    padding: '8px',
    borderBottom: `1px solid ${themeVars.color.border}`,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    position: 'relative' // For clear button positioning if needed, or just flex
});

export const searchInput = style({
    width: '100%',
    padding: '6px 24px 6px 8px', // Right padding for clear button
    borderRadius: '4px',
    border: `1px solid ${themeVars.color.border}`,
    backgroundColor: themeVars.color.background,
    color: themeVars.color.text,
    fontSize: '14px',
    outline: 'none',
    ':focus': {
        borderColor: themeVars.color.selectionBackground
    }
});

export const clearButton = style({
    position: 'absolute',
    right: '9px',
    top: '50%',
    transform: 'translateY(-50%)',
    background: 'transparent',
    border: 'none',
    color: themeVars.color.textLight,
    cursor: 'pointer',
    padding: '4px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': {
        color: themeVars.color.textSecondary,
    }
});

export const searchResultItem = style([itemBase, {
    flexDirection: 'column',
    alignItems: 'flex-start',
    padding: '6px 12px',
    gap: '4px'
}]);

export const resultName = style({
    fontWeight: 'bold',
    fontSize: '14px'
});

export const resultPath = style({
    fontSize: '12px',
    color: themeVars.color.textLight,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    width: '100%'
});

export const highlighted = style({
    backgroundColor: themeVars.color.hoverBackground
});

export const renameButton = style({
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: themeVars.color.rename,
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    marginRight: '4px',
});

export const deleteButton = style({
    margin: '-2px 0 -2px auto',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: themeVars.color.delete,
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
});

export const acceptButton = style({
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: themeVars.color.checkForeground,
    padding: '2px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
});


export const renameInput = style({
    fontFamily: 'inherit',
    fontSize: 'inherit',
    padding: '2px 4px',
    border: `none`,
    background: themeVars.color.background,
    color: themeVars.color.text,
    width: '100%',
    boxSizing: 'border-box',
    outline: 'none',
    margin: '-3px 0 -3px 0', // Adjust for padding diff
    borderRadius: '2px'
});


export const directoryToggleButton = style({
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    color: 'inherit',
    padding: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: '4px',
    fontSize: 'inherit',
});

export const contextMenu = style({
    padding: '4px',
    background: themeVars.color.background,
    border: `1px solid ${themeVars.color.border}`,
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '150px',
    // @ts-ignore
    positionAnchor: '--context-menu-trigger',
    // @ts-ignore
    positionArea: "bottom span-right",
    // @ts-ignore
    positionTryFallbacks: "flip-block, flip-inline",
    margin: 0,
    // Fallback or basic positioning if anchor fails (though we use popover)
    // Popover API handles top layer, but positioning needs anchor
    position: 'absolute',
});

export const contextMenuItem = style({
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    padding: '8px 12px',
    cursor: 'pointer',
    color: themeVars.color.text,
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    borderRadius: '4px',
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const contextMenuIcon = style({
    width: '16px',
    marginRight: '8px',
    textAlign: 'center',
    color: themeVars.color.textLight
});

