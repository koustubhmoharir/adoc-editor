import { globalStyle, style } from "@vanilla-extract/css";
import { vars as themeVars } from '../theme.css';

export const anchorName = '--popover-trigger';

export const container = style({
    padding: '4px',
    background: themeVars.color.background,
    border: `1px solid ${themeVars.color.border}`,
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
    display: 'flex',
    flexDirection: 'column',
    minWidth: '150px',
    // @ts-ignore
    positionAnchor: anchorName,
    // @ts-ignore
    positionArea: "bottom span-right",
    // @ts-ignore
    positionTryFallbacks: "flip-block, flip-inline",
    margin: 0,
    // Fallback or basic positioning if anchor fails (though we use popover)
    // Popover API handles top layer, but positioning needs anchor
    position: 'absolute',
});

globalStyle(`${container} button`, {
    background: 'transparent',
    border: 'none',
    textAlign: 'left',
    padding: '8px 12px',
    cursor: 'pointer',
    color: themeVars.color.text,
    fontSize: '14px',
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    borderRadius: '4px',
});

globalStyle(`${container} button:hover`, {
    backgroundColor: themeVars.color.hoverBackground
});