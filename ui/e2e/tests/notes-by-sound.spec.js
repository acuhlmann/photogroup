const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { waitForImage, dismissDialogs } = require('../helpers/test-helpers');

// Small changes go from phone to phone as sound when the network is weak: a
// name, a star rating and the list of photos that a phone has. The listener
// here is a browser whose microphone is a sound file with the tones that
// the app plays (the app's own encoder writes it).

const FIXTURE = path.join(__dirname, '../fixtures/test-image.jpg');
const MENU = 'Send small changes by sound';

function wavFile(samples, sampleRate) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

/** The sound of some notes, as the sharer's phone would play them. */
async function soundOf({ room, peerId, notes }) {
  const { loadModem, encodeTones } = await import('../../src/share/nearby/soundModem.js');
  const { encodeNotes, notesText, peerMark } = await import('../../src/share/nearby/notes.js');
  const ggwave = await loadModem();
  const rounds = encodeNotes({ room, from: peerMark(peerId), notes })
    .map(frame => encodeTones(ggwave, notesText(frame), { sampleRate: 48000 }));
  const gap = 48000;
  const samples = new Float32Array(rounds.reduce((sum, tones) => sum + tones.length + gap, gap));
  let at = gap;
  rounds.forEach((tones) => {
    samples.set(tones, at);
    at += tones.length + gap;
  });
  return wavFile(samples, 48000);
}

// The menu has this while the server does not answer (and in geek mode).
async function openSoundDialog(page) {
  await page.context().route('**/api/**', route => route.abort());
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(page.getByTestId('server-away')).toBeVisible({ timeout: 15000 });
  await dismissDialogs(page);
  await page.getByRole('button', { name: /Room menu/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(MENU) }).click();
}

test('a phone hears the name, the star rating and the photo list of a phone near it', async ({ browser }, testInfo) => {
  const sharer = await (await browser.newContext()).newPage();
  await sharer.goto('/', { waitUntil: 'domcontentloaded' });
  await sharer.getByRole('button', { name: /Start a room/i }).click();
  await expect(sharer).toHaveURL(/\?room=/, { timeout: 30000 });
  const roomUrl = sharer.url();
  const room = new URL(roomUrl).searchParams.get('room');
  await sharer.locator('input#contained-button-file').first().setInputFiles(FIXTURE);
  expect(await waitForImage(sharer, 30000)).toBe(true);
  const { photos, peers } = await (await sharer.request.get(`http://localhost:8081/api/rooms/${room}`)).json();

  // The sharer can play its notes.
  await openSoundDialog(sharer);
  await sharer.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sharer.getByRole('button', { name: 'Stop the sound' })).toBeVisible();
  await expect(sharer.getByText(/The sound takes about \d+ seconds\./)).toBeVisible({ timeout: 15000 });
  await sharer.getByRole('button', { name: 'Stop the sound' }).click();
  await sharer.getByRole('button', { name: 'Close' }).click();

  // What the sharer's phone would play after a name change and a rating with no server.
  const wav = testInfo.outputPath('notes.wav');
  fs.mkdirSync(path.dirname(wav), { recursive: true });
  fs.writeFileSync(wav, await soundOf({
    room,
    peerId: peers[0].peerId,
    notes: [
      { type: 'name', name: 'Anna' },
      { type: 'rating', photo: photos[0].infoHash, rating: 5 },
      { type: 'have', photos: [photos[0].infoHash] },
    ],
  }));

  const listenerBrowser = await chromium.launch({
    executablePath: testInfo.project.use.launchOptions?.executablePath,
    args: [
      '--no-sandbox',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${wav}`,
    ],
  });
  try {
    const listener = await (await listenerBrowser.newContext({ baseURL: 'http://localhost:3000' })).newPage();
    await listener.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await expect(listener.getByText('test-image.jpg').first()).toBeVisible({ timeout: 20000 });
    await openSoundDialog(listener);
    await listener.getByRole('button', { name: 'Listen' }).click();
    const heard = listener.getByTestId('heard-note');
    await expect(heard.filter({ hasText: 'Anna: the name is here.' })).toBeVisible({ timeout: 30000 });
    await expect(heard.filter({ hasText: 'Anna: 1 star rating received.' })).toBeVisible();
    await expect(heard.filter({ hasText: 'Anna has 1 of the 1 photos of this room.' })).toBeVisible();
    await listener.getByRole('button', { name: 'Close' }).click();
    await expect(listener.getByRole('button', { name: '5 stars' }).first()).toHaveAttribute('aria-pressed', 'true', { timeout: 10000 });
  } finally {
    await listenerBrowser.close();
  }
});
