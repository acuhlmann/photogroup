import { createTheme } from '@mui/material/styles';

const fontStack = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';
const monoStack = '"JetBrains Mono", "Fira Code", "SF Mono", "Cascadia Code", monospace';

/**
 * Shared MUI theme for light/dark. Dark-first technical aesthetic.
 * Used by AppWrapper (system preference) and App (settings toggle).
 */
export function createAppTheme(mode) {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? '#00e5ff' : '#0d9488',
        contrastText: isDark ? '#0a0e14' : '#fff',
      },
      secondary: {
        main: isDark ? '#a78bfa' : '#5b21b6',
      },
      success: {
        main: '#00e676',
      },
      warning: {
        main: '#ffab00',
      },
      error: {
        main: '#ff1744',
      },
      background: {
        default: isDark ? '#0a0e14' : '#f0f4f8',
        paper: isDark ? '#111820' : '#ffffff',
      },
      text: {
        primary: isDark ? '#e4e8ee' : '#1a1a2e',
        secondary: isDark ? '#8899aa' : '#64748b',
      },
      divider: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
    },
    shape: {
      borderRadius: 8,
    },
    typography: {
      fontFamily: fontStack,
      h6: { fontWeight: 600 },
      button: { fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          ':root': {
            '--font-mono': monoStack,
            '--glow-cyan': isDark ? '0 0 20px rgba(0,229,255,0.15)' : 'none',
            '--glow-purple': isDark ? '0 0 20px rgba(167,139,250,0.15)' : 'none',
            '--glow-green': isDark ? '0 0 12px rgba(0,230,118,0.2)' : 'none',
            '--glow-amber': isDark ? '0 0 12px rgba(255,171,0,0.2)' : 'none',
            '--glass-bg': isDark
              ? 'rgba(17,24,32,0.75)'
              : 'rgba(255,255,255,0.75)',
            '--glass-border': isDark
              ? 'rgba(255,255,255,0.06)'
              : 'rgba(0,0,0,0.06)',
          },
          body: {
            scrollbarColor: isDark ? '#2a3545 #0a0e14' : '#c1c9d2 #f0f4f8',
            scrollbarWidth: 'thin',
            '&::-webkit-scrollbar': {
              width: '6px',
            },
            '&::-webkit-scrollbar-track': {
              background: isDark ? '#0a0e14' : '#f0f4f8',
            },
            '&::-webkit-scrollbar-thumb': {
              background: isDark ? '#2a3545' : '#c1c9d2',
              borderRadius: '3px',
            },
          },
          '.tech-text': {
            fontFamily: monoStack,
            fontSize: '0.8rem',
            letterSpacing: '0.02em',
          },
          '.glass': {
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            border: '1px solid var(--glass-border)',
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
          },
          containedPrimary: isDark ? {
            boxShadow: '0 0 20px rgba(0,229,255,0.15)',
            '&:hover': {
              boxShadow: '0 0 30px rgba(0,229,255,0.25)',
            },
          } : {},
        },
      },
      MuiAppBar: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            background: isDark
              ? 'rgba(10,14,20,0.85)'
              : 'rgba(13,148,136,0.95)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            borderBottom: isDark
              ? '1px solid rgba(0,229,255,0.1)'
              : '1px solid rgba(255,255,255,0.1)',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            backgroundImage: 'none',
          },
          elevation0: {
            background: isDark
              ? 'rgba(17,24,32,0.6)'
              : '#ffffff',
            backdropFilter: isDark ? 'blur(12px)' : 'none',
            WebkitBackdropFilter: isDark ? 'blur(12px)' : 'none',
            border: isDark
              ? '1px solid rgba(255,255,255,0.06)'
              : '1px solid rgba(0,0,0,0.06)',
          },
        },
      },
      MuiAccordion: {
        defaultProps: {
          elevation: 0,
        },
        styleOverrides: {
          root: {
            background: isDark
              ? 'rgba(17,24,32,0.6)'
              : '#ffffff',
            backdropFilter: isDark ? 'blur(12px)' : 'none',
            WebkitBackdropFilter: isDark ? 'blur(12px)' : 'none',
            border: isDark
              ? '1px solid rgba(255,255,255,0.06)'
              : '1px solid rgba(0,0,0,0.06)',
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
            fontSize: '0.75rem',
            fontWeight: 500,
          },
        },
      },
      MuiDialog: {
        styleOverrides: {
          paper: {
            background: isDark ? '#111820' : '#ffffff',
            border: isDark ? '1px solid rgba(255,255,255,0.08)' : 'none',
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              '& fieldset': {
                borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.12)',
              },
              '&:hover fieldset': {
                borderColor: isDark ? 'rgba(0,229,255,0.3)' : 'rgba(13,148,136,0.5)',
              },
            },
          },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: {
            transition: 'all 0.2s ease',
            '&:hover': {
              background: isDark
                ? 'rgba(0,229,255,0.08)'
                : 'rgba(13,148,136,0.08)',
            },
          },
        },
      },
      MuiSwitch: {
        styleOverrides: {
          root: isDark ? {
            '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': {
              backgroundColor: '#00e5ff',
              opacity: 0.5,
            },
          } : {},
        },
      },
    },
  });
}
