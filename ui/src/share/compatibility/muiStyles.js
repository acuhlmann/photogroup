/**
 * Compatibility shim for @mui/styles with React 19
 * 
 * The @mui/styles package is deprecated and doesn't work well with React 19.
 * This module provides compatible implementations of withStyles and withTheme.
 */
import React from 'react';
import { useTheme } from '@mui/material/styles';

/**
 * withStyles HOC replacement
 * Injects a 'classes' prop into the wrapped component
 */
export function withStyles(styles) {
  return function withStylesHOC(WrappedComponent) {
    const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
    
    function WithStyles(props) {
      const theme = useTheme();
      
      // Generate classes from styles
      const classes = React.useMemo(() => {
        const styleObj = typeof styles === 'function' ? styles(theme) : styles;
        // Convert style objects to class names (we'll use inline styles via sx prop pattern)
        // For compatibility, we return the style objects directly as "classes"
        return styleObj;
      }, [theme]);
      
      return <WrappedComponent {...props} classes={classes} />;
    }
    
    WithStyles.displayName = `WithStyles(${displayName})`;
    return WithStyles;
  };
}

/**
 * withTheme HOC replacement
 * Injects a 'theme' prop into the wrapped component
 */
export function withTheme(WrappedComponent) {
  const displayName = WrappedComponent.displayName || WrappedComponent.name || 'Component';
  
  function WithTheme(props) {
    const theme = useTheme();
    return <WrappedComponent {...props} theme={theme} />;
  }
  
  WithTheme.displayName = `WithTheme(${displayName})`;
  return WithTheme;
}
