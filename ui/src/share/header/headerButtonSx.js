// Shared look for the header's top-right controls: hairline-bordered,
// equal-height segments that read like the telemetry panels below them.
export const headerButtonSx = {
    height: 34,
    minWidth: 34,
    px: 1,
    gap: 0.75,
    borderRadius: '8px',
    border: '1px solid',
    borderColor: 'divider',
    color: 'text.primary',
    transition: 'border-color 140ms cubic-bezier(0.2, 0, 0, 1), background-color 140ms cubic-bezier(0.2, 0, 0, 1)',
    '&:hover': {
        borderColor: 'primary.main',
        backgroundColor: 'var(--accent-soft)',
    },
    '& .MuiSvgIcon-root': {
        fontSize: 18,
    },
};

export const headerLabelSx = {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.68rem',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    lineHeight: 1,
};
