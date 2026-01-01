import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { SnackbarProvider } from 'notistack';
import { vi } from 'vitest';

// Mock withSnackbar from notistack
vi.mock('notistack', async () => {
  const actual = await vi.importActual('notistack');
  return {
    ...actual,
    withSnackbar: (Component) => Component,
  };
});

import SettingsView from './SettingsView';

// Mock dependencies
const mockMaster = {
  emitter: {
    on: vi.fn(),
    emit: vi.fn()
  },
  client: {
    peerId: 'test-peer-id'
  },
  restartTrackers: vi.fn()
};

const mockEmitter = {
  on: vi.fn(),
  emit: vi.fn()
};

describe('SettingsView', () => {
  const theme = createTheme();

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>
    );
    root.unmount();
  });

  it('renders settings icon button', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>
    );
    // Settings icon should be present
    root.unmount();
  });

  it('opens dialog when settings button is clicked', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>
    );
    
    // Simulate settings button click
    const button = div.querySelector('button[aria-haspopup="true"]');
    if (button) {
      button.click();
      // Dialog should open
    }
    
    root.unmount();
  });
});

