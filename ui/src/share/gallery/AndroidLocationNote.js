import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LocationOnRounded from '@mui/icons-material/LocationOnRounded';
import { KEEP_LOCATION_STEPS, MATERIAL_FILES_URL, onAndroid } from '../header/androidUpload';

const DISMISSED = 'photogroup.androidLocationNote';

function dismissedBefore() {
    try {
        return localStorage.getItem(DISMISSED) === '1';
    } catch {
        return false;
    }
}

/**
 * Tells Android users how to share photos with their location kept, since
 * Android removes it from anything picked the usual way. Shown until they
 * dismiss it; elsewhere it renders nothing.
 */
function AndroidLocationNote({ narrow }) {
    const [hidden, setHidden] = useState(() => !onAndroid() || dismissedBefore());
    if (hidden) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(DISMISSED, '1');
        } catch {
            // Hide it for this visit anyway.
        }
        setHidden(true);
    };

    return (
        <Box data-testid="android-location-note" sx={{
            mb: 2, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
            maxWidth: narrow ? 880 : 'none', mx: narrow ? 'auto' : 0,
        }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <LocationOnRounded aria-hidden="true" sx={{ fontSize: 20, color: 'primary.main', mt: '1px' }} />
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>Keep where your photos were taken</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                        Android removes the location when a browser selects photos in the usual way. {KEEP_LOCATION_STEPS}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <Button size="small" variant="outlined" href={MATERIAL_FILES_URL} target="_blank" rel="noopener noreferrer"
                            sx={{ textTransform: 'none' }}>
                            Get Material Files
                        </Button>
                        <Button size="small" onClick={dismiss} sx={{ textTransform: 'none' }}>Got it</Button>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

AndroidLocationNote.propTypes = {
    narrow: PropTypes.bool,
};

export default AndroidLocationNote;
