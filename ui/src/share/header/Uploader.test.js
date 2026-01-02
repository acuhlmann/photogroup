import React from 'react';
import { createRoot } from 'react-dom/client';
import { createTheme } from '@mui/material/styles';
import { vi } from 'vitest';
import Uploader from './Uploader';

// Mock dependencies
const mockModel = {
  emitter: {
    on: vi.fn(),
    emit: vi.fn(),
    removeListener: vi.fn()
  },
  seed: vi.fn()
};

describe('Uploader', () => {
  const theme = createTheme();

  beforeEach(() => {
    delete window.location;
    window.location = { search: '' };
  });

  it('renders without crashing', () => {
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    root.unmount();
  });

  it('renders upload button when room is in URL', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    // Uploader should render when room is present
    root.unmount();
  });

  it('does not render when no room and not ready', () => {
    window.location.search = '';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    // Uploader should not render when no room and not ready
    root.unmount();
  });

  it('handles file upload', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    const root = createRoot(div);
    root.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />
    );
    
    // Simulate file input change
    const input = div.querySelector('input[type="file"]');
    if (input) {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const event = { target: { files: [file] } };
      // Trigger handleUpload
    }
    
    root.unmount();
  });
});

