import { createTheme } from '@mui/material/styles';

const fontStack = '"Source Sans 3", "Segoe UI", system-ui, sans-serif';

/**
 * Shared MUI theme for light/dark. Used by AppWrapper (system preference) and App (settings toggle).
 */
export function createAppTheme(mode) {
  const isDark = mode === 'dark';

  return createTheme({
    palette: {
      mode,
      primary: {
        main: isDark ? '#4fd1c5' : '#0d9488',
        contrastText: '#fff',
      },
      secondary: {
        main: isDark ? '#a78bfa' : '#5b21b6',
      },
      background: {
        default: isDark ? '#0f1419' : '#f4f6f8',
        paper: isDark ? '#1a222c' : '#ffffff',
      },
    },
    shape: {
      borderRadius: 12,
    },
    typography: {
      fontFamily: fontStack,
      h6: { fontWeight: 600 },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: {
            scrollbarColor: isDark ? '#3d4a5c #1a222c' : '#c1c9d2 #f4f6f8',
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
        },
      },
      MuiAppBar: {
        defaultProps: {
          elevation: 0,
          color: 'primary',
        },
      },
    },
  });
}
