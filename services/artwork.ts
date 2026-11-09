const MAX_FILE_BYTES = 15 * 1024 * 1024;

export function fitArtwork(width: number, height: number, boxWidth: number, boxHeight: number) {
  const scale = Math.min(boxWidth / width, boxHeight / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  return { x: (boxWidth - fittedWidth) / 2, y: (boxHeight - fittedHeight) / 2, width: fittedWidth, height: fittedHeight };
}

export async function validateArtworkFile(file: File): Promise<void> {
  if (!file.size) throw new Error('This image file is empty. Please choose another file.');
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose an image smaller than 15 MB.');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp = bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70 &&
    bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
  if (!png && !jpeg && !webp) throw new Error('Choose a PNG, JPEG, or WebP image. Other file formats are not supported.');
}

export function artworkDimensions(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('This image has invalid dimensions. Please choose another file.');
  }
  if (width > 16000 || height > 16000 || width * height > 64000000) {
    throw new Error('This image is too large to process. Export a smaller version from your art tool.');
  }
  const scale = Math.min(1, 2400 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Normalize to a self-contained JPEG understood by existing storage and exports. */
export async function readArtworkFile(file: File): Promise<{ base64: string; width: number; height: number }> {
  await validateArtworkFile(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    try { await image.decode(); } catch { throw new Error('This image could not be opened. It may be damaged. Please choose another file.'); }
    const size = artworkDimensions(image.naturalWidth, image.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this image. Please reload and retry.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.94);
    if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('Your browser could not save this image. Please choose another file.');
    return { base64: dataUrl.slice(dataUrl.indexOf(',') + 1), ...size };
  } finally {
    URL.revokeObjectURL(url);
  }
}
