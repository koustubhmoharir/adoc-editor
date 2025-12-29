import { createGlobalTheme } from '@vanilla-extract/css';

export const vars = createGlobalTheme(':root', {
    color: {
        background: '#fff',
        text: '#333',
        headerBackground: '#333',
        headerText: '#fff'
    },
    space: {
        small: '10px',
        medium: '20px'
    }
});
