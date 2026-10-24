import React, { useState } from 'react';
import PropTypes from 'prop-types';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Stack from '@mui/material/Stack';

// The geek tour in three steps, for people who just want the idea.
export const SIMPLE_STEPS = [
    {
        title: 'You share a photo',
        body: 'Your phone makes a fingerprint of the photo. The photo stays on your phone.',
    },
    {
        title: 'The server connects the phones',
        body: 'The server tells the other phones about the new photo and helps them find your phone. The server does not get the photo.',
    },
    {
        title: 'The photo goes from phone to phone',
        body: 'The photo goes directly to the other phones, encrypted. If that is not possible, the server keeps a copy for 24 hours at most.',
    },
];

const LEFT = { x: 46, y: 118 };
const RIGHT = { x: 234, y: 118 };
const SERVER = { x: 140, y: 34 };

function Phone({ x, y, lit }) {
    return (
        <g opacity={lit ? 1 : 0.35}>
            <rect x={x - 18} y={y - 30} width="36" height="60" rx="7" fill="none" stroke="currentColor" strokeWidth="2.5" />
            <rect x={x - 11} y={y - 21} width="22" height="34" rx="2" fill="currentColor" opacity="0.15" />
        </g>
    );
}

Phone.propTypes = { x: PropTypes.number, y: PropTypes.number, lit: PropTypes.bool };

/** A dot that moves along a straight line, over and over. */
function Mover({ from, to, delay = 0, color }) {
    return (
        <circle r="5" fill={color} style={{
            offsetPath: `path('M ${from.x} ${from.y} L ${to.x} ${to.y}')`,
            animation: `howMove 1.8s ${delay}s ease-in-out infinite`,
        }} />
    );
}

Mover.propTypes = { from: PropTypes.object, to: PropTypes.object, delay: PropTypes.number, color: PropTypes.string };

/** Two phones and the server, with what moves between them at this step. */
function Diagram({ step }) {
    const serverLit = step === 1;
    return (
        <Box sx={{
            color: 'text.primary', mx: 'auto', width: '100%', maxWidth: 300,
            '@keyframes howMove': { from: { offsetDistance: '0%' }, to: { offsetDistance: '100%' } },
            '@keyframes howPulse': { '50%': { opacity: 0.25 } },
            '@media (prefers-reduced-motion: reduce)': { '& circle': { animation: 'none !important' } },
        }}>
            <svg viewBox="0 0 280 172" width="100%" role="img" aria-label={SIMPLE_STEPS[step].title}>
                <g opacity={serverLit ? 1 : 0.35}>
                    <rect x={SERVER.x - 34} y={SERVER.y - 18} width="68" height="36" rx="8" fill="none" stroke="currentColor" strokeWidth="2.5" />
                    <text x={SERVER.x} y={SERVER.y + 5} textAnchor="middle" fontSize="13" fill="currentColor">server</text>
                </g>
                <Phone {...LEFT} lit />
                <Phone {...RIGHT} lit={step !== 0} />
                <text x={LEFT.x} y={166} textAnchor="middle" fontSize="12" fill="currentColor">you</text>
                <text x={RIGHT.x} y={166} textAnchor="middle" fontSize="12" fill="currentColor" opacity={step ? 1 : 0.35}>friend</text>

                {step === 0 && (
                    <circle cx={LEFT.x} cy={LEFT.y - 4} r="8" fill="var(--mui-palette-primary-main, #0f766e)"
                        style={{ animation: 'howPulse 1.4s ease-in-out infinite' }} />
                )}
                {step === 1 && (
                    <>
                        <line x1={LEFT.x} y1={LEFT.y - 30} x2={SERVER.x - 20} y2={SERVER.y + 18} stroke="currentColor" strokeDasharray="4 4" opacity="0.5" />
                        <line x1={RIGHT.x} y1={RIGHT.y - 30} x2={SERVER.x + 20} y2={SERVER.y + 18} stroke="currentColor" strokeDasharray="4 4" opacity="0.5" />
                        <Mover from={{ x: LEFT.x, y: LEFT.y - 30 }} to={{ x: SERVER.x - 20, y: SERVER.y + 18 }} color="#3b82f6" />
                        <Mover from={{ x: SERVER.x + 20, y: SERVER.y + 18 }} to={{ x: RIGHT.x, y: RIGHT.y - 30 }} delay={0.9} color="#3b82f6" />
                    </>
                )}
                {step === 2 && (
                    <>
                        <line x1={LEFT.x + 18} y1={LEFT.y} x2={RIGHT.x - 18} y2={RIGHT.y} stroke="#10b981" strokeWidth="3" />
                        <Mover from={{ x: LEFT.x + 18, y: LEFT.y }} to={{ x: RIGHT.x - 18, y: RIGHT.y }} color="#10b981" />
                        <Mover from={{ x: LEFT.x + 18, y: LEFT.y }} to={{ x: RIGHT.x - 18, y: RIGHT.y }} delay={0.6} color="#10b981" />
                        <Mover from={{ x: LEFT.x + 18, y: LEFT.y }} to={{ x: RIGHT.x - 18, y: RIGHT.y }} delay={1.2} color="#10b981" />
                    </>
                )}
            </svg>
        </Box>
    );
}

Diagram.propTypes = { step: PropTypes.number.isRequired };

/** "How does it work?" and the three steps behind it. */
export default function SimpleHowItWorks({ buttonSx }) {
    const [open, setOpen] = useState(false);
    const [step, setStep] = useState(0);
    const last = step === SIMPLE_STEPS.length - 1;
    const close = () => {
        setOpen(false);
        setStep(0);
    };
    return (
        <>
            <Button color="inherit" onClick={() => setOpen(true)} sx={{ textTransform: 'none', color: 'text.secondary', ...buttonSx }}>
                How does it work?
            </Button>
            <Dialog open={open} onClose={close} maxWidth="xs" fullWidth aria-label="How it works">
                <DialogContent data-testid="simple-how">
                    <Typography variant="overline" sx={{ color: 'text.secondary' }}>{`Step ${step + 1} of ${SIMPLE_STEPS.length}`}</Typography>
                    <Diagram step={step} />
                    <Typography variant="h6" component="h2" data-testid="simple-how-title" sx={{ fontWeight: 700, mt: 1 }}>
                        {SIMPLE_STEPS[step].title}
                    </Typography>
                    <Typography variant="body1" sx={{ mt: 0.5 }}>{SIMPLE_STEPS[step].body}</Typography>
                    <Stack direction="row" spacing={0.75} sx={{ justifyContent: 'center', mt: 2 }} aria-hidden="true">
                        {SIMPLE_STEPS.map((item, index) => (
                            <Box key={item.title} sx={{ width: index === step ? 18 : 8, height: 8, borderRadius: 8,
                                bgcolor: index <= step ? 'primary.main' : 'action.disabled', transition: 'width .15s' }} />
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ justifyContent: 'space-between' }}>
                    <Button onClick={() => setStep(step - 1)} disabled={step === 0}>Back</Button>
                    <Button variant="contained" onClick={() => (last ? close() : setStep(step + 1))}>{last ? 'Done' : 'Next'}</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

SimpleHowItWorks.propTypes = { buttonSx: PropTypes.object };
