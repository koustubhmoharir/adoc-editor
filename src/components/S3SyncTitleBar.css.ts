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
