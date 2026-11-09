import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { generateEpub } from '../services/epub';

test('EPUB embeds uploaded JPEG bytes in the cover and the correct chapter', async () => {
  const coverBytes = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 255, 217]);
  const chapterBytes = new Uint8Array([255, 216, 255, 224, 0, 16, 67, 72, 65, 80, 255, 217]);
  const cover = Buffer.from(coverBytes).toString('base64');
  const image = Buffer.from(chapterBytes).toString('base64');
  const epub = await generateEpub('Uploaded art', 'A book with supplied images.', [
    { chapterNumber: 0, title: 'Introduction', content: 'Text without an illustration.', isGenerating: false },
    { chapterNumber: 1, title: 'The illustrated chapter', content: 'Text with an illustration.', isGenerating: false, image },
  ], cover);
  const zip = await JSZip.loadAsync(await epub.arrayBuffer());
  assert.deepEqual(await zip.file('OEBPS/images/cover.jpg')!.async('uint8array'), coverBytes);
  assert.deepEqual(await zip.file('OEBPS/images/chap_1.jpg')!.async('uint8array'), chapterBytes);
  assert.equal(zip.file('OEBPS/images/chap_0.jpg'), null);
  assert.match(await zip.file('OEBPS/content.opf')!.async('string'), /media-type="image\/jpeg"/);
  assert.match(await zip.file('OEBPS/chapter_1.xhtml')!.async('string'), /images\/chap_1.jpg/);
});
