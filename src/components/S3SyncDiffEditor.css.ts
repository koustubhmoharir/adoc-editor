import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const container = style({
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: vars.color.background,
    color: vars.color.textSecondary,
    minWidth: 0,
});

export const placeholder = style({
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    textAlign: 'center',
    fontSize: '14px',
});

export const icon = style({
    fontSize: '48px',
    opacity: 0.5,
});
