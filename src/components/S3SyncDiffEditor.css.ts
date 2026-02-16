import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const container = style({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: vars.color.background,
    minWidth: 0,
    minHeight: 0,
});

export const singlePane = style({
    overflow: 'hidden',
    position: 'relative',
});

export const diffPane = style({
    overflow: 'hidden',
    position: 'relative',
});

export const placeholder = style({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '12px',
    textAlign: 'center',
    fontSize: '14px',
    color: vars.color.textSecondary,
});

export const placeholderIcon = style({
    fontSize: '48px',
    opacity: 0.5,
});

export const loadingState = style({
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    color: vars.color.textSecondary,
});

export const actionButton = style({
    padding: '6px 12px',
    backgroundColor: vars.color.background,
    border: `1px solid ${vars.color.border}`,
    borderRadius: '4px',
    cursor: 'pointer',
    color: vars.color.text,
    fontSize: '13px',
    transition: 'all 0.2s',
    ':hover': {
        backgroundColor: vars.color.hoverBackground,
        borderColor: vars.color.textSecondary,
    }
});
