import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const container = style({
    height: '22px',
    backgroundColor: vars.color.headerBackground,
    color: vars.color.headerText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end', // Right align items like VS Code (mostly)
    padding: '0',
    marginLeft: '-8px',
    borderTop: `1px solid ${vars.color.border}`,
    fontSize: '12px',
    userSelect: 'none'
});

export const item = style({
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    cursor: 'pointer',
    padding: '0 8px',
    height: '100%',
    ':hover': {
        backgroundColor: vars.color.hoverBackground
    }
});

export const languageButton = style([item, {
    background: 'none',
    border: 'none',
    color: 'inherit',
    font: 'inherit',
    outline: 'none'
}]);

export const languageList = style({
    maxHeight: '300px',
    overflowY: 'auto',
    width: '100%'
});
