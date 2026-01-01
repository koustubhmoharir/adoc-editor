import { style } from '@vanilla-extract/css';
import { vars } from './theme.css';

export const container = style({
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    width: '100vw',
    overflow: 'hidden',
    fontFamily: 'Inter, system-ui, sans-serif',
    backgroundColor: vars.color.background,
    color: vars.color.text
});

export const workspace = style({
    display: 'flex',
    flex: 1,
    overflow: 'hidden'
});

export const main = style({
    flex: 1,
    overflow: 'hidden',
    position: 'relative'
});
