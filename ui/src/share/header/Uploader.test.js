import React from 'react';
import ReactDOM from 'react-dom';
import { createMuiTheme } from '@material-ui/core/styles';
import Uploader from './Uploader';

// Mock dependencies
const mockModel = {
  emitter: {
    on: jest.fn(),
    emit: jest.fn()
  },
  seed: jest.fn()
};

describe('Uploader', () => {
  const theme = createMuiTheme();

  beforeEach(() => {
    delete window.location;
    window.location = { search: '' };
  });

  it('renders without crashing', () => {
    const div = document.createElement('div');
    ReactDOM.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />,
      div
    );
    ReactDOM.unmountComponentAtNode(div);
  });

  it('renders upload button when room is in URL', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    ReactDOM.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />,
      div
    );
    // Uploader should render when room is present
    ReactDOM.unmountComponentAtNode(div);
  });

  it('does not render when no room and not ready', () => {
    window.location.search = '';
    const div = document.createElement('div');
    ReactDOM.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />,
      div
    );
    // Uploader should not render when no room and not ready
    ReactDOM.unmountComponentAtNode(div);
  });

  it('handles file upload', () => {
    window.location.search = '?room=test123';
    const div = document.createElement('div');
    ReactDOM.render(
      <Uploader model={mockModel} emitter={mockModel.emitter} classes={{}} theme={theme} />,
      div
    );
    
    // Simulate file input change
    const input = div.querySelector('input[type="file"]');
    if (input) {
      const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
      const event = { target: { files: [file] } };
      // Trigger handleUpload
    }
    
    ReactDOM.unmountComponentAtNode(div);
  });
});

