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

export const editorPane = style({
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative',
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

export const paneLabel = style({
    position: 'absolute',
    top: '4px',
    left: '8px',
    fontSize: '11px',
    color: vars.color.textSecondary,
    backgroundColor: vars.color.background,
    padding: '2px 6px',
    borderRadius: '4px',
    zIndex: 10,
    pointerEvents: 'none',
});
