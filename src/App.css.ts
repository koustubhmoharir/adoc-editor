import { style } from '@vanilla-extract/css';
import { vars } from './theme.css';

export const container = style({
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'Inter, system-ui, sans-serif'
});

export const header = style({
    padding: vars.space.small,
    background: vars.color.headerBackground,
    color: vars.color.headerText
});

export const main = style({
    flex: 1,
    overflow: 'hidden'
});
