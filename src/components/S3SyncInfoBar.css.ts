import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const container = style({
    display: 'flex',
    alignItems: 'center',
    padding: '0',
    backgroundColor: vars.color.background,
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0,
    fontSize: '13px',
});

export const section = style({
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    padding: '8px 12px',
});

export const statusLabel = style({
    color: vars.color.textSecondary,
});

export const statusValue = style({
    fontWeight: 500,
    color: vars.color.text,
});

export const viewButton = style({
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: '4px',
    color: vars.color.text,
    cursor: 'pointer',
    fontSize: '13px',
    ':hover': {
        backgroundColor: vars.color.hoverBackground,
    }
});

export const viewMenu = style({
    display: 'flex',
    flexDirection: 'column',
    padding: '4px 0',
    minWidth: '140px',
});

export const viewMenuItem = style({
    padding: '6px 12px',
    textAlign: 'left',
    backgroundColor: 'transparent',
    border: 'none',
    color: vars.color.text,
    cursor: 'pointer',
    fontSize: '13px',
    ':hover': {
        backgroundColor: vars.color.hoverBackground,
    }
});

export const viewMenuItemActive = style({
    backgroundColor: vars.color.selectionBackground,
    color: vars.color.selectionForeground,
});

export const emptyState = style({
    color: vars.color.textSecondary,
    fontStyle: 'italic',
});

export const actionButton = style({
    padding: '4px 8px',
    backgroundColor: vars.color.background, // fallback for now
    color: vars.color.text,
    border: `1px solid ${vars.color.border}`,
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    ':hover': {
        backgroundColor: vars.color.hoverBackground,
    }
});
