import React from 'react';
import Logger from 'js-logger';
import Typography from '@mui/material/Typography';

// One broken tile (e.g. a media API WebTorrent no longer has) must not
// unmount the whole app and leave a blank screen. The wrapper div also stays
// mounted when a tile swaps from loading to content, so the gallery's
// fade-in doesn't replay and blank every tile at once.
export default class TileErrorBoundary extends React.Component {

    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidCatch(error) {
        Logger.error('tile render failed for ' + this.props.fileName + ': ' + error.message);
    }

    render() {
        return <div>
            {this.state.error
                ? <Typography variant="body2" sx={{ p: 2, color: 'text.secondary' }}>
                    Could not display {this.props.fileName || 'this file'}.
                </Typography>
                : this.props.children}
        </div>;
    }
}
