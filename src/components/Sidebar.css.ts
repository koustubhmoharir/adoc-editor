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
    fontFamily: 'sans-serif'
});

export const emptyState = style({
    padding: '16px',
    color: themeVars.color.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic'
});

export const treeContainer = style({
    paddingBottom: '8px',
    paddingLeft: '12px'
});

export const itemBase = style({
    cursor: 'pointer',
    padding: '4px 8px',
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

export const directoryItem = style([itemBase, {
    fontWeight: 'bold',
    paddingRight: '4px'
}]);

export const fileItem = style([itemBase, {
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
    marginRight: '6px',
    opacity: 1 // Ensure full opacity for colors
});

export const folderIcon = style({
    color: themeVars.color.folderIcon
});

export const fileIcon = style({
    color: themeVars.color.fileIcon
});

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
    fontSize: '16px',
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
