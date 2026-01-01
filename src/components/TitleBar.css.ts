import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const header = style({
    height: '40px',
    backgroundColor: vars.color.headerBackground,
    color: vars.color.headerText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0
});

export const leftSection = style({
    display: 'flex',
    alignItems: 'center',
    gap: '16px'
});

export const centerSection = style({
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center'
});

export const rightSection = style({
    display: 'flex',
    alignItems: 'center'
});

export const title = style({
    margin: 0,
    fontSize: '16px',
    fontWeight: 'bold'
});

export const fileName = style({
    fontSize: '14px'
});

export const dirtyIndicator = style({
    marginLeft: '4px',
    color: vars.color.textSecondary // Use secondary or specific accent
});

export const button = style({
    backgroundColor: 'transparent',
    border: `1px solid ${vars.color.border}`,
    color: 'inherit',
    borderRadius: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '12px',
    ':hover': {
        backgroundColor: vars.color.hoverBackground
    }
});
