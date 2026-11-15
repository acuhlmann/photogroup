import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import CloudOffRounded from '@mui/icons-material/CloudOffRounded';
import DirectLinkDialog, { LINK_TITLE } from './DirectLinkDialog';
import { canLinkDirectly } from './directConnect';

export const AWAY_TEXT = 'No connection to the server. The room works with phones near you.';

/** Whether the server does not answer now. */
export function useServerAway(master) {
    const [away, setAway] = useState(() => !!master.offlineRoom?.away);
    useEffect(() => {
        const onAway = value => setAway(!!value);
        master.emitter.on('serverAway', onAway);
        setAway(!!master.offlineRoom?.away);
        return () => master.emitter.removeListener('serverAway', onAway);
    }, [master]);
    return away;
}

/**
 * Shown in a room while the server does not answer. The room still works:
 * this is where a phone connects to a phone near it with no server.
 */
export default function ServerAwayBar({ master }) {
    const away = useServerAway(master);
    const [linking, setLinking] = useState(false);
    const [linked, setLinked] = useState(() => (master.nearbyLinks?.open().length || 0));

    useEffect(() => {
        const onLinks = snapshot => setLinked(snapshot.links.filter(link => link.status === 'open').length);
        master.emitter.on('directLink', onLinks);
        return () => master.emitter.removeListener('directLink', onLinks);
    }, [master]);

    // An open link stays reachable when the server is back.
    if (!away && !linked && !linking) return null;
    const canLink = canLinkDirectly() && !!master.nearbyLinks;

    return (
        <>
            {(away || linked > 0) && (
                <Box
                    role="status"
                    data-testid="server-away"
                    sx={{
                        display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 2, py: 0.75,
                        bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider',
                    }}
                >
                    {away && <CloudOffRounded fontSize="small" sx={{ color: 'text.secondary' }} />}
                    <Typography variant="body2" sx={{ flex: '1 1 200px', minWidth: 0 }}>
                        {away ? AWAY_TEXT : ''}
                        {linked > 0 && `${away ? ' ' : ''}${linked === 1 ? '1 phone is' : `${linked} phones are`} connected directly.`}
                    </Typography>
                    {canLink && (
                        <Button size="small" variant="outlined" onClick={() => setLinking(true)} sx={{ textTransform: 'none', flexShrink: 0 }}>
                            {linked > 0 ? 'Direct link' : LINK_TITLE}
                        </Button>
                    )}
                </Box>
            )}
            {linking && <DirectLinkDialog master={master} open onClose={() => setLinking(false)} />}
        </>
    );
}

ServerAwayBar.propTypes = {
    master: PropTypes.object.isRequired,
};
