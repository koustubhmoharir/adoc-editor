import { style } from '@vanilla-extract/css';
import { sidebarWidth, vars } from '../theme.css';

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
    width: sidebarWidth,
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
    alignItems: 'center',
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

// Specific styles for theme states
export const themeButtonDark = style([button, {
    color: '#4b5563', // Dark gray for moon (switching to dark mode)
}]);

export const themeButtonLight = style([button, {
    color: '#fde047', // Lighter yellow for sun (switching to light mode)
}]);

export const helpButton = style([button, {
    color: '#0ea5e9', // Sky blue
}]);

export const newFileButton = style([button, {
    color: vars.color.newFileIcon,
    marginLeft: "auto",
}]);


