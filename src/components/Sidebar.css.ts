import { style } from '@vanilla-extract/css';
import { vars as themeVars } from '../theme.css';

export const sidebar = style({
    width: '250px',
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
    paddingTop: '8px',
    paddingBottom: '8px'
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
}]);

export const fileItem = style([itemBase, {
}]);

export const selected = style({
    backgroundColor: themeVars.color.selectionBackground,
    color: themeVars.color.selectionForeground
});

export const icon = style({
    marginRight: '6px',
    opacity: 0.8
});
