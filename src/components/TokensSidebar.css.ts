import { style } from '@vanilla-extract/css';
import { vars as themeVars } from '../theme.css';

export const sidebar = style({
    width: '300px',
    height: '100%',
    backgroundColor: themeVars.color.background,
    borderLeft: `1px solid ${themeVars.color.border}`,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: '12px'
});

export const header = style({
    padding: '8px 12px',
    backgroundColor: themeVars.color.hoverBackground,
    borderBottom: `1px solid ${themeVars.color.border}`,
    fontWeight: 'bold',
    fontSize: '11px',
    textTransform: 'uppercase',
    color: themeVars.color.textSecondary,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
});

export const tokenList = style({
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden'
});

export const tokenItem = style({
    display: 'flex',
    padding: '6px 8px',
    borderBottom: `1px solid ${themeVars.color.border}`,
    cursor: 'pointer',
    color: themeVars.color.text,
    gap: '8px',
    alignItems: 'flex-start', // Align to top
    minHeight: '40px', // Ensure touch target and visibility
    ':hover': {
        backgroundColor: themeVars.color.hoverBackground
    }
});

export const activeToken = style({
    backgroundColor: themeVars.color.selectionBackground,
    color: themeVars.color.selectionForeground,
    ':hover': {
        backgroundColor: themeVars.color.selectionBackground
    }
});

export const tokenLine = style({
    color: themeVars.color.textSecondary,
    width: '30px',
    flexShrink: 0,
    textAlign: 'right',
    paddingTop: '2px', // Align with the first line of text
    fontSize: '11px'
});

export const tokenType = style({
    color: themeVars.color.textSecondary, // Use theme variable for better contrast
    fontSize: '11px',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    marginBottom: '2px'
});

export const tokenText = style({
    fontWeight: 'bold',
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: themeVars.color.text,
    minHeight: '16px' // Ensure height for descenders
});

export const checkIcon = style({
    color: '#4caf50', // Green
    marginLeft: '8px',
    fontSize: '16px',
    alignSelf: 'center'
});
