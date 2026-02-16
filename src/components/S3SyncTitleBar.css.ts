import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const header = style({
    height: '40px',
    backgroundColor: vars.color.headerBackground,
    color: vars.color.headerText,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: `1px solid ${vars.color.border}`,
    flexShrink: 0
});

export const leftSection = style({
    padding: '0 0 0 16px',
    display: 'flex',
    alignItems: 'center',
});

export const centerSection = style({
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
});

export const rightSection = style({
    display: 'flex',
    alignItems: 'center',
});

export const title = style({
    margin: '0 16px 0 0',
    fontSize: '16px',
    fontWeight: 'bold'
});

export const syncInfo = style({
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontSize: '14px',
});

export const syncInfoLabel = style({
    color: vars.color.textSecondary,
    marginRight: '4px',
});

export const syncInfoValue = style({
    fontWeight: 'bold',
});

export const button = style({
    border: 'none',
    backgroundColor: 'transparent',
    color: 'inherit',
    padding: '8px',
    cursor: 'pointer',
    fontSize: '20px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    ':hover': {
        backgroundColor: vars.color.hoverBackground
    }
});

export const themeButtonDark = style([button, {
    color: '#4b5563',
}]);

export const themeButtonLight = style([button, {
    color: '#fde047',
}]);


export const exitButton = style([button, {
    fontSize: '14px',
    padding: '4px 12px',
    marginRight: '8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: '4px',
    gap: '6px',
}]);

export const modeSelector = style({
    marginLeft: '16px',
});

export const modeSelect = style({
    padding: '4px 8px',
    borderRadius: '4px',
    border: `1px solid ${vars.color.border}`,
    backgroundColor: vars.color.background,
    color: vars.color.text,
    fontSize: '14px',
    cursor: 'pointer',
});

export const goButton = style({
    marginLeft: '8px',
    padding: '5px 12px',
    borderRadius: '4px',
    border: `1px solid ${vars.color.border}`,
    backgroundColor: vars.color.background,
    color: vars.color.text,
    fontSize: '14px',
    fontWeight: 'bold',
    cursor: 'not-allowed',
    opacity: 0.5, // Initially disabled state
    selectors: {
        '&:not(:disabled)': {
            opacity: 1,
            cursor: 'pointer'
        },
        '&:not(:disabled):hover': {
            backgroundColor: vars.color.hoverBackground
        }
    }
});
