import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCoverIllustrationPrompt, buildIllustrationPrompt } from '../services/illustrations';

const outline = { title: 'Industry & Society', description: 'A history of industrial change.', chapters: [{ chapterNumber: 1, title: 'Steam', summary: 'Engines and society.' }] };
const chapter = { chapterNumber: 1, title: 'Steam', content: 'How factories transformed production.', isGenerating: false, illustrationPrompt: 'Pen and ink factory cutaway with a steam engine.' };

test('chapter illustration includes the saved user art direction and substantive chapter context', () => {
  const prompt = buildIllustrationPrompt(chapter, outline, 'educational_nonfiction');
  assert.match(prompt, /Pen and ink factory cutaway/);
  assert.match(prompt, /factories transformed/);
  assert.match(prompt, /Engines and society/);
  assert.match(prompt, /not fabricated documentary/);
});

test('cover prompt respects custom visual direction and book title', () => {
  const prompt = buildCoverIllustrationPrompt(outline, 'Vintage travel poster in ochre and navy.');
  assert.match(prompt, /Vintage travel poster in ochre and navy/);
  assert.match(prompt, /Industry & Society/);
  assert.match(prompt, /600 800/);
  assert.match(prompt, /SVG/);
});
