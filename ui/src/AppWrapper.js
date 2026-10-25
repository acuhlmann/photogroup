import React from 'react';
import useMediaQuery from '@mui/material/useMediaQuery';
import { ThemeProvider } from '@mui/material/styles';
import App from "./App";
import { createAppTheme } from './theme';
import { isDark, onColorsChange, readColors } from './share/colors';

export default function AppWrapper() {
    const deviceIsDark = useMediaQuery('(prefers-color-scheme: dark)');
    const [colors, setColors] = React.useState(readColors);
    React.useEffect(() => onColorsChange(setColors), []);
    const dark = isDark(colors, deviceIsDark);

    const theme = React.useMemo(
        () => createAppTheme(dark ? 'dark' : 'light'),
        [dark],
    );

    return (
        <ThemeProvider theme={theme}>
            <App theme={theme}/>
        </ThemeProvider>
    );
}
