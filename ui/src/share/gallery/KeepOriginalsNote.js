import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import LocationOnRounded from '@mui/icons-material/LocationOnRounded';
import { KEEP_LOCATION_STEPS, MATERIAL_FILES_URL, onAndroid } from '../header/androidUpload';
import { IPHONE_CLIP_STEPS, IPHONE_LOCATION_STEPS, onIPhone } from '../header/iphoneUpload';
import { readPreference } from '../preferences';

const DISMISSED = { android: 'photogroup.androidLocationNote', iphone: 'photogroup.iphoneOriginalsNote' };

function dismissedBefore(platform) {
    try {
        return localStorage.getItem(DISMISSED[platform]) === '1';
    } catch {
        return false;
    }
}

function platformNow() {
    if (onAndroid()) return 'android';
    if (onIPhone()) return 'iphone';
    return null;
}

/**
 * Tells phone users how to share originals, since the phone hands a browser
 * copies when photos are picked the usual way: Android removes the location,
 * an iPhone removes it unless asked not to and makes clips smaller. Shown
 * until they dismiss it; elsewhere it renders nothing.
 */
function KeepOriginalsNote({ narrow }) {
    const [platform] = useState(platformNow);
    const removeLocation = readPreference('removeLocation');
    const [hidden, setHidden] = useState(() => !platform || dismissedBefore(platform)
        || (platform === 'android' && removeLocation));
    if (hidden) return null;

    const dismiss = () => {
        try {
            localStorage.setItem(DISMISSED[platform], '1');
        } catch {
            // Hide it for this visit anyway.
        }
        setHidden(true);
    };

    const android = platform === 'android';
    return (
        <Box data-testid={android ? 'android-location-note' : 'iphone-originals-note'} sx={{
            mb: 2, p: 1.5, borderRadius: 2, border: 1, borderColor: 'divider', bgcolor: 'action.hover',
            maxWidth: narrow ? 880 : 'none', mx: narrow ? 'auto' : 0,
        }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                <LocationOnRounded aria-hidden="true" sx={{ fontSize: 20, color: 'primary.main', mt: '1px' }} />
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        {android ? 'Keep where your photos were taken' : 'Share your iPhone originals'}
                    </Typography>
                    {android ? (
                        <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                            Android removes the location when a browser selects photos in the usual way. {KEEP_LOCATION_STEPS}
                        </Typography>
                    ) : (
                        <>
                            {!removeLocation && (
                                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
                                    The iPhone removes the location from photos you add, unless you allow it. {IPHONE_LOCATION_STEPS}
                                </Typography>
                            )}
                            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, mt: removeLocation ? 0 : 0.5 }}>
                                {IPHONE_CLIP_STEPS}
                            </Typography>
                        </>
                    )}
                    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        {android && (
                            <Button size="small" variant="outlined" href={MATERIAL_FILES_URL} target="_blank" rel="noopener noreferrer"
                                sx={{ textTransform: 'none' }}>
                                Get Material Files
                            </Button>
                        )}
                        <Button size="small" onClick={dismiss} sx={{ textTransform: 'none' }}>Got it</Button>
                    </Stack>
                </Box>
            </Stack>
        </Box>
    );
}

KeepOriginalsNote.propTypes = {
    narrow: PropTypes.bool,
};

export default KeepOriginalsNote;
