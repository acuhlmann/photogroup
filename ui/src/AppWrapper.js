import React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider } from '@mui/material/styles';
import App from "./App";
import { createAppTheme } from './theme';

export default function AppWrapper() {
    const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)');
    // Default to dark mode unless system explicitly prefers light
    const prefersDarkMode = systemPrefersDark !== false;

    const theme = React.useMemo(
        () => createAppTheme(prefersDarkMode ? 'dark' : 'light'),
        [prefersDarkMode],
    );

    return (
        <ThemeProvider theme={theme}>
            <App prefersDarkMode={prefersDarkMode}/>
        </ThemeProvider>
    );
}