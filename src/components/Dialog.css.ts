import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const dialog = style({
    backgroundColor: vars.color.background,
    border: `1px solid ${vars.color.border}`,
    borderRadius: '4px',
    minWidth: '300px',
    maxWidth: '500px',
    padding: 0,
    color: vars.color.text,
    boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
    '::backdrop': {
        backgroundColor: 'rgba(0, 0, 0, 0.5)'
    }
});

export const dialogContent = style({
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
});

export const header = style({
    padding: `${vars.space.small} ${vars.space.medium}`,
    backgroundColor: vars.color.headerBackground,
    borderBottom: `1px solid ${vars.color.border}`,
    fontWeight: 'bold',
    color: vars.color.headerText
});

export const body = style({
    padding: vars.space.medium,
    lineHeight: '1.5',
});

export const footer = style({
    padding: `${vars.space.small} ${vars.space.medium}`,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: vars.space.small,
    borderTop: `1px solid ${vars.color.border}`,
    backgroundColor: vars.color.background
});

export const button = style({
    padding: '6px 12px',
    borderRadius: '4px',
    border: `1px solid ${vars.color.border}`,
    backgroundColor: vars.color.headerBackground, // Use a neutral background
    color: vars.color.text,
    cursor: 'pointer',
    fontSize: '0.9rem',
    minWidth: '70px',
    ':hover': {
        backgroundColor: vars.color.hoverBackground
    }
});

export const primaryButton = style([button, {
    backgroundColor: '#0070f3',
    color: '#ffffff',
    border: 'none',
    ':hover': {
        backgroundColor: '#0060df'
    }
}]);
