import { style } from '@vanilla-extract/css';

export const workspace = style({
    display: 'flex',
    flex: 1,
    minHeight: '0'
});

export const main = style({
    flex: 1,
    position: 'relative',
    minWidth: '0'
});
