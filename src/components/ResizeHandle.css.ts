import { style } from '@vanilla-extract/css';
import { vars } from '../theme.css';

export const horizontalHandle = style({
    height: '8px',
    cursor: 'row-resize',
    ':hover': {
        borderTop: `2px solid ${vars.color.selectionBackground}`
    },
    userSelect: 'none',
    backgroundColor: 'transparent',
    flexShrink: 0,
});

export const verticalHandle = style({
    width: '8px',
    cursor: 'col-resize',
    ':hover': {
        borderLeft: `2px solid ${vars.color.selectionBackground}`
    },
    userSelect: 'none',
    backgroundColor: 'transparent',
    flexShrink: 0,
});
