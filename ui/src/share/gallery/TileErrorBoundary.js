import React from 'react';
import Logger from 'js-logger';
import Typography from '@mui/material/Typography';

// One broken tile (e.g. a media API WebTorrent no longer has) must not
// unmount the whole app and leave a blank screen. The wrapper div also stays
// mounted when a tile swaps from loading to content, so the gallery does not
// rebuild that tile's DOM every time its state changes.
//
// The wrapper carries no entrance animation on purpose. The browser restarts
// the animation of any node it re-inserts, so an entrance that begins at
// opacity 0 blanks the tiles it moves: every re-order of the gallery hid the
// photos already on screen. See the note in App.css.
export default class TileErrorBoundary extends React.Component {

    constructor(props) {
        super(props);
        this.state = { error: null };
    }

    static getDerivedStateFromError(error) {
        return { error };
    }

    componentDidUpdate(prevProps) {
        // A tile that failed while loading gets a fresh try once it's done.
        if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
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
