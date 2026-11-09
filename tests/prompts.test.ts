import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildChapterPrompt, buildOutlinePrompt, buildRefinementPrompt, formatSources } from '../services/prompts';
import { SourceType } from '../types';

const source = { id: 'r1', type: SourceType.TEXT, name: 'Census report', content: 'Population was 123 in 2010.', isProcessing: false,
  research: { url: 'https://en.wikipedia.org/wiki/Test', retrievedAt: '2026-11-09T12:00:00Z', revisionDate: '2026-10-01T00:00:00Z' } };
const outline = { title: 'An explained history', description: 'Causes and consequences', chapters: [] };
const chapter = { chapterNumber: 1, title: 'The evidence', summary: 'Explain the population trend.' };

test('nonfiction outline uses evidence rather than fictional plot scaffolding', () => {
  const prompt = buildOutlinePrompt('Use US examples.', { style: 'educational_nonfiction' });
  assert.match(prompt, /historical|history/i);
  assert.match(prompt, /wit/i);
  assert.match(prompt, /Never invent/);
  assert.match(prompt, /Use US examples/);
  assert.doesNotMatch(prompt, /master storyteller|character dynamics/);
});

test('nonfiction chapter never receives mandatory dramatization, private thoughts, or rigid tense', () => {
  const prompt = buildChapterPrompt(chapter, outline, { style: 'educational_nonfiction', pov: 'omniscient', tense: 'present',
    previousChapterEnding: 'Earlier evidence.', nextChapterSummary: 'Policy.', customInstruction: 'Explain to adults new to history.' });
  assert.doesNotMatch(prompt, /fully dramatized|internal thoughts|strictly in PRESENT|THIRD-PERSON OMNISCIENT/);
  assert.match(prompt, /as of|date/i);
  assert.match(prompt, /citations/i);
  assert.match(prompt, /Explain to adults/);
  assert.match(prompt, /Earlier evidence/);
});

test('fiction retains scene, POV, and tense guidance', () => {
  const prompt = buildChapterPrompt(chapter, outline, { style: 'literary', pov: 'first', tense: 'past' });
  assert.match(prompt, /FIRST-PERSON/);
  assert.match(prompt, /PAST TENSE/);
  assert.match(prompt, /scenes/);
});

test('refinement keeps the complete multi-part request and factual protections', () => {
  const prompt = buildRefinementPrompt('A claim [Census report].', 'Improve sensory language, preserve citations, and cut 20%.', {
    style: 'educational_nonfiction', sources: [source], customInstruction: 'No invented dialogue.' });
  assert.match(prompt, /Improve sensory language, preserve citations, and cut 20%/);
  assert.match(prompt, /No invented dialogue/);
  assert.match(prompt, /Population was 123/);
  assert.match(prompt, /Never invent/);
});

test('research is transmitted with full excerpt, URL, retrieval date and revision date', () => {
  const result = formatSources([{ ...source, content: 'x'.repeat(6000) + 'END OF EVIDENCE' }]);
  assert.match(result, /END OF EVIDENCE/);
  assert.match(result, /https:\/\/en.wikipedia.org\/wiki\/Test/);
  assert.match(result, /2026-10-01/);
  assert.match(result, /2026-11-09/);
});
