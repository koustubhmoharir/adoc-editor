import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const sidebar = style({
    width: '300px',
    height: '100%',
    backgroundColor: vars.color.background,
    borderRight: `1px solid ${vars.color.border}`,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    fontSize: '14px',
    fontFamily: 'sans-serif',
});

export const header = style({
    padding: '12px',
    fontWeight: 'bold',
    fontSize: '14px',
    color: vars.color.text,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
});

export const itemList = style({
    flex: 1,
    overflow: 'auto',
});

export const item = style({
    cursor: 'pointer',
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    color: vars.color.text,
    ':hover': {
        backgroundColor: vars.color.hoverBackground
    }
});

export const itemSelected = style({
    backgroundColor: vars.color.selectionBackground,
    color: vars.color.selectionForeground,
    ':hover': {
        backgroundColor: vars.color.selectionBackground,
    }
});

export const itemPath = style({
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
});

export const statusIcon = style({
    width: '16px',
    textAlign: 'center',
    flexShrink: 0,
});

export const statusNew = style({
    color: '#22c55e', // Green
});

export const statusChanged = style({
    color: '#f59e0b', // Amber
});

export const statusDeleted = style({
    color: '#ef4444', // Red
});

export const statusConflict = style({
    color: '#dc2626', // Red
});

export const statusWarning = style({
    color: '#f97316', // Orange
});

export const statusUnchanged = style({
    color: vars.color.textSecondary,
});

export const emptyState = style({
    padding: '24px 12px',
    color: vars.color.textSecondary,
    textAlign: 'center',
    fontStyle: 'italic',
});

export const loadingState = style({
    padding: '24px 12px',
    color: vars.color.textSecondary,
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '8px',
});

export const statusBadge = style({
    fontSize: '11px',
    padding: '2px 6px',
    borderRadius: '4px',
    backgroundColor: vars.color.hoverBackground,
    color: vars.color.textSecondary,
    flexShrink: 0,
});
