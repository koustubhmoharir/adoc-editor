import { createThemeContract, createTheme } from '@vanilla-extract/css';

export const vars = createThemeContract({
    color: {
        background: null,
        text: null,
        headerBackground: null,
        headerText: null
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
        headerBackground: '#f0f0f0',
        headerText: '#333333'
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
        headerBackground: '#333333',
        headerText: '#ffffff'
    },
    space: {
        small: '10px',
        medium: '20px'
    }
});

