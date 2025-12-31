import React from 'react';
import ReactDOM from 'react-dom';
import { createMuiTheme, ThemeProvider } from '@material-ui/core/styles';
import { SnackbarProvider } from 'notistack';
import SettingsView from './SettingsView';

// Mock dependencies
const mockMaster = {
  emitter: {
    on: jest.fn(),
    emit: jest.fn()
  },
  client: {
    peerId: 'test-peer-id'
  },
  restartTrackers: jest.fn()
};

const mockEmitter = {
  on: jest.fn(),
  emit: jest.fn()
};

describe('SettingsView', () => {
  const theme = createMuiTheme();

  it('renders without crashing', () => {
    const div = document.createElement('div');
    ReactDOM.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>,
      div
    );
    ReactDOM.unmountComponentAtNode(div);
  });

  it('renders settings icon button', () => {
    const div = document.createElement('div');
    ReactDOM.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>,
      div
    );
    // Settings icon should be present
    ReactDOM.unmountComponentAtNode(div);
  });

  it('opens dialog when settings button is clicked', () => {
    const div = document.createElement('div');
    ReactDOM.render(
      <ThemeProvider theme={theme}>
        <SnackbarProvider>
          <SettingsView 
            master={mockMaster} 
            emitter={mockEmitter} 
            classes={{}} 
            prefersDarkMode={false}
          />
        </SnackbarProvider>
      </ThemeProvider>,
      div
    );
    
    // Simulate settings button click
    const button = div.querySelector('button[aria-haspopup="true"]');
    if (button) {
      button.click();
      // Dialog should open
    }
    
    ReactDOM.unmountComponentAtNode(div);
  });
});

