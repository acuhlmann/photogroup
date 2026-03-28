import React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider } from '@mui/material/styles';
import App from "./App";
import { createAppTheme } from './theme';

export default function AppWrapper() {
    const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

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