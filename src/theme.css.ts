import { createThemeContract, createTheme } from '@vanilla-extract/css';

export const vars = createThemeContract({
    color: {
        background: null,
        text: null,
        textSecondary: null,
        headerBackground: null,
        headerText: null,
        border: null,
        hoverBackground: null,
        selectionBackground: null,
        selectionForeground: null,
        checkBackground: null,
        checkForeground: null,
        codeBackground: null
    },
    space: {
        small: null,
        medium: null
    }
});

export const lightTheme = createTheme(vars, {
    color: {
        background: '#ffffff',
        text: '#333333',
        textSecondary: '#555555',
        headerBackground: '#f0f0f0',
        headerText: '#333333',
        border: '#dddddd',
        hoverBackground: '#e8e8e8',
        selectionBackground: '#0078d4',
        selectionForeground: '#ffffff',
        checkBackground: '#1e8e3e',
        checkForeground: '#e6f4ea',
        codeBackground: '#f5f5f5'
    },
    space: {
        small: '10px',
        medium: '20px'
    }
});

export const darkTheme = createTheme(vars, {
    color: {
        background: '#1e1e1e',
        text: '#d4d4d4',
        textSecondary: '#aaaaaa',
        headerBackground: '#333333',
        headerText: '#ffffff',
        border: '#3e3e3e',
        hoverBackground: '#2a2d2e',
        selectionBackground: '#094771',
        selectionForeground: '#ffffff',
        checkBackground: '#4caf50',
        checkForeground: '#0e3a1f',
        codeBackground: '#2d2d2d'
    },
    space: {
        small: '10px',
        medium: '20px'
    }
});

