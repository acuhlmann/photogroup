const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// One phone plays the room code as sound; a phone that listens joins the
// room. The listener here is a browser whose microphone is a sound file with
// the same tones the app plays (the app's own encoder writes it).

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

async function soundOf(text, quiet) {
  const { loadModem, encodeTones } = await import('../../src/share/nearby/soundModem.js');
  const { roomCodeText } = await import('../../src/share/nearby/roomCode.js');
  const tones = encodeTones(await loadModem(), roomCodeText(text), { sampleRate: 48000, quiet });
  // Silence around the tones, as between two rounds.
  const samples = new Float32Array(tones.length + 48000 * 2);
  samples.set(tones, 48000);
  return wavFile(samples, 48000);
}

for (const quiet of [false, true]) {
  test(`a phone joins the room it hears (${quiet ? 'high sound' : 'sound'})`, async ({ browser }, testInfo) => {
    const sharer = await (await browser.newContext()).newPage();
    await sharer.goto('/', { waitUntil: 'domcontentloaded' });
    await sharer.getByRole('button', { name: /Start a room/i }).click();
    await expect(sharer).toHaveURL(/\?room=/, { timeout: 30000 });
    const room = new URL(sharer.url()).searchParams.get('room');

    // The sharer plays the code from Invite.
    await sharer.getByRole('button', { name: /Invite people/ }).click();
    await sharer.getByRole('button', { name: 'Send the code by sound' }).click();
    await expect(sharer.getByRole('button', { name: 'Stop the sound' })).toBeVisible();
    await expect(sharer.getByText(/Listen for the sound instead/)).toBeVisible();
    if (quiet) await sharer.getByLabel('Use a high sound that most people cannot hear').check();

    const wav = testInfo.outputPath('room-code.wav');
    fs.mkdirSync(path.dirname(wav), { recursive: true });
    fs.writeFileSync(wav, await soundOf({ room }, quiet));

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
      await listener.goto('/', { waitUntil: 'domcontentloaded' });
      await listener.getByRole('button', { name: 'Scan to join' }).click();
      await listener.getByRole('button', { name: 'Listen for the sound instead' }).click();
      await expect(listener).toHaveURL(new RegExp('\\?room=' + room), { timeout: 30000 });
      await expect(listener.getByRole('dialog')).toHaveCount(0);
      // Both are in the room now.
      await expect(listener.getByRole('button', { name: /Invite people \(2 in the room\)/ })).toBeVisible({ timeout: 20000 });
    } finally {
      await listenerBrowser.close();
    }
    await sharer.getByRole('button', { name: 'Stop the sound' }).click();
    await expect(sharer.getByRole('button', { name: 'Send the code by sound' })).toBeVisible();
  });
}
