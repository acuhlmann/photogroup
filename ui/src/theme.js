import { createTheme } from '@mui/material/styles';

const fontStack = '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
const monoStack = '"JetBrains Mono", ui-monospace, "SFMono-Regular", monospace';
const snap = '140ms cubic-bezier(0.2, 0, 0, 1)';

/**
 * Shared MUI theme for light/dark.
 * Dark-first instrument panel: graphite surfaces, one teal accent, mono telemetry.
 */
export function createAppTheme(mode) {
  const isDark = mode === 'dark';

  const accent = isDark ? '#3dd6c3' : '#0f766e';
  const accentInk = isDark ? '#06221d' : '#ffffff';
  const accentHover = isDark ? '#67e6d6' : '#0c655e';
  const bg = isDark ? '#07090d' : '#f3f5f7';
  const paper = isDark ? '#10141c' : '#ffffff';
  const ink = isDark ? '#e8eef6' : '#141820';
  const muted = isDark ? '#8b97a8' : '#5c6775';
  const line = isDark ? 'rgba(232,238,246,0.09)' : 'rgba(20,24,32,0.1)';
  const accentSoft = isDark ? 'rgba(61,214,195,0.12)' : 'rgba(15,118,110,0.1)';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: accent,
        contrastText: accentInk,
      },
      secondary: {
        main: isDark ? '#9aa8ff' : '#3d4a9a',
      },
      success: {
        main: isDark ? '#3dde8b' : '#047857',
      },
      warning: {
        main: isDark ? '#f5b942' : '#b45309',
      },
      error: {
        main: isDark ? '#ff5d73' : '#be123c',
      },
      background: {
        default: bg,
        paper,
      },
      text: {
        primary: ink,
        secondary: muted,
      },
      divider: line,
    },
    shape: {
      borderRadius: 10,
    },
    typography: {
      fontFamily: fontStack,
      h1: { fontWeight: 600, letterSpacing: '-0.035em' },
      h2: { fontWeight: 600, letterSpacing: '-0.03em' },
      h3: { fontWeight: 600, letterSpacing: '-0.03em' },
      h4: { fontWeight: 600, letterSpacing: '-0.02em' },
      h5: { fontWeight: 600, letterSpacing: '-0.02em' },
      h6: { fontWeight: 600, letterSpacing: '-0.015em' },
      subtitle1: { fontWeight: 600, letterSpacing: '-0.015em' },
      subtitle2: { fontWeight: 600, letterSpacing: '-0.01em' },
      button: { fontWeight: 600, letterSpacing: '0.01em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            '--font-mono': monoStack,
            '--accent': accent,
            '--accent-ink': accentInk,
            '--accent-soft': accentSoft,
            '--bg': bg,
            '--paper': paper,
            '--ink': ink,
            '--muted': muted,
            '--line': line,
            '--grid-line': isDark ? 'rgba(232,238,246,0.045)' : 'rgba(20,24,32,0.05)',
            colorScheme: mode,
          },
          html: {
            colorScheme: mode,
          },
          body: {
            backgroundColor: bg,
            color: ink,
            accentColor: accent,
            scrollbarColor: isDark ? '#2c3544 #07090d' : '#c5ced6 #f3f5f7',
            scrollbarWidth: 'thin',
          },
          '::selection': {
            background: isDark ? 'rgba(61,214,195,0.28)' : 'rgba(15,118,110,0.2)',
            color: ink,
          },
          '.tech-text': {
            fontFamily: monoStack,
            fontSize: '0.75rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          },
          '.glass': {
            background: isDark ? 'rgba(16,20,28,0.78)' : 'rgba(255,255,255,0.82)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            border: `1px solid ${line}`,
          },
        },
      },
      MuiButton: {
        defaultProps: {
          disableElevation: true,
        },
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            borderRadius: 8,
            transition: `background-color ${snap}, border-color ${snap}, color ${snap}, transform 80ms cubic-bezier(0.2, 0, 0, 1)`,
            '&:active': {
              transform: 'translateY(1px)',
            },
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
              '&:active': { transform: 'none' },
            },
          },
          containedPrimary: {
            '&:hover': {
              backgroundColor: accentHover,
            },
          },
          outlined: {
            borderColor: line,
            '&:hover': {
              borderColor: accent,
              backgroundColor: accentSoft,
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: `background-color ${snap}, color ${snap}`,
            '&:hover': {
              background: accentSoft,
              color: accent,
            },
          },
        },
      },
      MuiAppBar: {
        defaultProps: {
          elevation: 0,
          color: 'transparent',
        },
        styleOverrides: {
          root: {
            background: isDark ? 'rgba(7,9,13,0.78)' : 'rgba(243,245,247,0.84)',
            color: ink,
            backdropFilter: 'blur(18px) saturate(1.15)',
            WebkitBackdropFilter: 'blur(18px) saturate(1.15)',
            borderBottom: `1px solid ${line}`,
            backgroundImage: 'none',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          elevation0: {
            background: isDark ? 'rgba(16,20,28,0.9)' : '#ffffff',
            border: `1px solid ${line}`,
          },
        },
      },
      MuiAccordion: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            background: isDark ? 'rgba(16,20,28,0.9)' : '#ffffff',
            border: `1px solid ${line}`,
            '&:before': {
              display: 'none',
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontFamily: monoStack,
            fontSize: '0.68rem',
            fontWeight: 500,
            letterSpacing: '0.04em',
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            background: paper,
            backgroundImage: 'none',
            border: `1px solid ${isDark ? 'rgba(232,238,246,0.12)' : line}`,
            boxShadow: isDark
              ? '0 24px 80px rgba(0,0,0,0.55)'
              : '0 24px 60px rgba(20,24,32,0.12)',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: {
          root: {
            fontWeight: 600,
            letterSpacing: '-0.02em',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderColor: line,
              },
              '&:hover fieldset': {
                borderColor: isDark ? 'rgba(61,214,195,0.45)' : 'rgba(15,118,110,0.45)',
              },
              '&.Mui-focused fieldset': {
                borderColor: accent,
              },
            },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          switchBase: {
            '&.Mui-checked': {
              color: accent,
              '& + .MuiSwitch-track': {
                backgroundColor: accent,
                opacity: 0.45,
              },
            },
          },
        },
      },
      MuiTabs: {
        styleOverrides: {
          indicator: {
            height: 2,
            borderRadius: 1,
          },
        },
      },
      MuiTab: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            fontWeight: 600,
            letterSpacing: '0.01em',
            minHeight: 40,
          },
        },
      },
    },
  });
}
