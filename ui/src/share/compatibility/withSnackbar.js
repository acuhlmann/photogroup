import React from 'react';
import { useSnackbar } from 'notistack';

/**
 * Compatibility wrapper for notistack v3
 * Replaces the removed withSnackbar HOC
 */
export function withSnackbar(Component) {
  return function WithSnackbarComponent(props) {
    const { enqueueSnackbar, closeSnackbar } = useSnackbar();
    
    return (
      <Component
        {...props}
        enqueueSnackbar={enqueueSnackbar}
        closeSnackbar={closeSnackbar}
      />
    );
  };
}

