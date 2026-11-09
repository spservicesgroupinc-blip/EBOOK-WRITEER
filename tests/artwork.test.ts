import assert from 'node:assert/strict';
import { test } from 'node:test';
import { artworkDimensions, fitArtwork, validateArtworkFile } from '../services/artwork';

test('accepts PNG, JPEG and WebP signatures even when the browser supplies no MIME type', async () => {
  for (const [name, bytes] of [
    ['art.png', [137, 80, 78, 71, 13, 10, 26, 10]],
    ['art.jpg', [255, 216, 255, 224]],
    ['art.webp', [82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]],
  ] as const) {
    await validateArtworkFile(new File([new Uint8Array(bytes)], name));
  }
});

test('rejects disguised SVG/HTML, empty files and oversized uploads', async () => {
  await assert.rejects(() => validateArtworkFile(new File(['<svg onload="alert(1)"></svg>'], 'fake.png', { type: 'image/png' })), /PNG, JPEG, or WebP/);
  await assert.rejects(() => validateArtworkFile(new File([], 'empty.jpg')), /empty/);
  await assert.rejects(() => validateArtworkFile({ size: 16 * 1024 * 1024 } as File), /15 MB/);
});

test('preserves portrait, landscape and square proportions without enlarging small images', () => {
  assert.deepEqual(artworkDimensions(3000, 4000), { width: 1800, height: 2400 });
  assert.deepEqual(artworkDimensions(4000, 2000), { width: 2400, height: 1200 });
  assert.deepEqual(artworkDimensions(300, 300), { width: 300, height: 300 });
});

test('rejects invalid dimensions and excessive decoded images', () => {
  for (const [width, height] of [[0, 10], [10, NaN], [17000, 100], [10000, 10000]]) {
    assert.throws(() => artworkDimensions(width, height), /dimensions|large/i);
  }
});

test('square and portrait artwork fits inside PDF frames without being stretched or cropped', () => {
  assert.deepEqual(fitArtwork(640, 640, 800, 450), { x: 175, y: 0, width: 450, height: 450 });
  assert.deepEqual(fitArtwork(1200, 1800, 900, 1200), { x: 50, y: 0, width: 800, height: 1200 });
});
