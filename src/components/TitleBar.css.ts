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
    fontWeight: 'bold',
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

export const fileName = style({
    fontSize: '14px',
});

export const fileNameClickable = style({
    cursor: 'pointer',
    ':hover': {
        textDecoration: 'underline'
    }
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
}]);

export const pickDirButton = style([button, {
    color: vars.color.folderIcon,
}]);

export const pickButton = style([button, {
    color: vars.color.folderIcon,
}]);

export const warningIcon = style({
    marginRight: '8px',
    color: '#ef4444',
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
});

export const actionButton = style([button, {
    fontSize: '14px',
    padding: '4px 8px',
    marginLeft: '8px',
    border: `1px solid ${vars.color.border}`,
    borderRadius: '4px',
}]);

export const searchFilesButton = style([button, {
    //color: vars.color.newFileIcon,
}]);


