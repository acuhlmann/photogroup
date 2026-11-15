const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { waitForImage } = require('../helpers/test-helpers');

// A photo goes from one phone's screen to another phone's camera as a stream
// of codes, with no network between them. The codes here are the app's own:
// its frame format, its fountain code, the same QR writer and reader.

const FIXTURE = path.join(__dirname, '../fixtures/test-image.jpg');
const ZXING = path.join(__dirname, '../../node_modules/zxing-wasm/dist');

async function writer() {
  const zxing = await import('zxing-wasm/writer');
  zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(path.join(ZXING, 'writer/zxing_writer.wasm')) } });
  return zxing;
}

async function reader() {
  const zxing = await import('zxing-wasm/reader');
  zxing.prepareZXingModule({ overrides: { wasmBinary: fs.readFileSync(path.join(ZXING, 'reader/zxing_reader.wasm')) } });
  return zxing;
}

/** A video file (Y4M) that shows one code in each frame. */
async function videoOfCodes(frames, { side = 640, fps = 10 } = {}) {
  const { writeBarcode } = await writer();
  const parts = [Buffer.from(`YUV4MPEG2 W${side} H${side} F${fps}:1 Ip A1:1 C420jpeg\n`)];
  for (const bytes of frames) {
    const { symbol } = await writeBarcode(bytes, { format: 'QRCode', ecLevel: 'L', withQuietZones: false });
    const scale = Math.floor(side / (symbol.width + 8));
    const offset = Math.floor((side - symbol.width * scale) / 2);
    const luma = Buffer.alloc(side * side, 235);
    for (let y = 0; y < symbol.height; y++) {
      for (let x = 0; x < symbol.width; x++) {
        if (symbol.data[y * symbol.width + x] !== 0) continue;
        for (let dy = 0; dy < scale; dy++) luma.fill(16, (offset + y * scale + dy) * side + offset + x * scale, (offset + y * scale + dy) * side + offset + (x + 1) * scale);
      }
    }
    parts.push(Buffer.from('FRAME\n'), luma, Buffer.alloc(side * side / 2, 128));
  }
  return Buffer.concat(parts);
}

test('a phone gets a photo from the codes on another screen', async ({ browser }, testInfo) => {
  // The sharer adds a photo and leaves: no device has it, the server has no copy.
  const sharerContext = await browser.newContext();
  const sharer = await sharerContext.newPage();
  await sharer.goto('/', { waitUntil: 'domcontentloaded' });
  await sharer.getByRole('button', { name: /Start a room/i }).click();
  await expect(sharer).toHaveURL(/\?room=/, { timeout: 30000 });
  const roomUrl = sharer.url();
  const room = new URL(roomUrl).searchParams.get('room');
  await sharer.locator('input#contained-button-file').first().setInputFiles(FIXTURE);
  expect(await waitForImage(sharer, 30000)).toBe(true);
  const { photos } = await (await sharer.request.get(`http://localhost:8081/api/rooms/${room}`)).json();
  expect(photos).toHaveLength(1);
  await sharerContext.close();

  // What the sharer's screen would show, as the receiver's camera picture.
  const { createLightSender } = await import('../../src/share/nearby/lightFrames.js');
  const file = new Uint8Array(fs.readFileSync(FIXTURE));
  const sender = createLightSender({ id: photos[0].infoHash, name: 'test-image.jpg', type: 'image/jpeg' }, file, 900);
  const frames = Array.from({ length: sender.blocks + 12 }, () => sender.next());
  const video = testInfo.outputPath('codes.y4m');
  fs.mkdirSync(path.dirname(video), { recursive: true });
  fs.writeFileSync(video, await videoOfCodes(frames));

  const receiverBrowser = await chromium.launch({
    executablePath: testInfo.project.use.launchOptions?.executablePath,
    args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${video}`],
  });
  try {
    const receiver = await (await receiverBrowser.newContext({ baseURL: 'http://localhost:3000' })).newPage();
    await receiver.goto(roomUrl, { waitUntil: 'domcontentloaded' });
    await expect(receiver.getByText('test-image.jpg').first()).toBeVisible({ timeout: 20000 });
    // Nobody has the photo, so it cannot arrive over the network.
    await receiver.waitForTimeout(3000);
    expect(await waitForImage(receiver, 1000)).toBe(false);

    await receiver.getByRole('button', { name: /Room menu/ }).click();
    await receiver.getByRole('menuitem', { name: /Get photos by camera/ }).click();
    await expect(receiver.getByTestId('light-progress')).toHaveText('test-image.jpg is here.', { timeout: 30000 });
    await receiver.getByRole('button', { name: 'Close' }).click();
    expect(await waitForImage(receiver, 20000)).toBe(true);
  } finally {
    await receiverBrowser.close();
  }
});

test('a photo is shown as codes that carry the whole file', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /Start a room/i }).click();
  await expect(page).toHaveURL(/\?room=/, { timeout: 30000 });
  await page.locator('input#contained-button-file').first().setInputFiles(FIXTURE);
  expect(await waitForImage(page, 30000)).toBe(true);

  await page.locator('img[src^="blob:"]').first().click();
  await page.getByRole('button', { name: 'Send by camera' }).click();
  const code = page.getByTestId('light-code');
  await expect(code).toBeVisible();
  await expect(page.getByText(/test-image\.jpg · 4\.\d+ kB · about \d+ seconds/)).toBeVisible({ timeout: 15000 });

  // Read the codes off the screen, as a camera would.
  const { readBarcodes } = await reader();
  const { createLightReceiver } = await import('../../src/share/nearby/lightFrames.js');
  const receiver = createLightReceiver();
  let state = null;
  const until = Date.now() + 30000;
  while (!state?.done && Date.now() < until) {
    const png = await code.screenshot();
    const [found] = await readBarcodes(new Blob([png]), { formats: ['QRCode'] });
    if (found?.bytes?.length) state = receiver.add(found.bytes) || state;
  }
  expect(state?.done).toBe(true);
  const result = receiver.result();
  expect(result.details).toMatchObject({ name: 'test-image.jpg', type: 'image/jpeg' });
  expect(Buffer.from(result.file).equals(fs.readFileSync(FIXTURE))).toBe(true);
});
