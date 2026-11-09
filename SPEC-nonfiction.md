# Factual nonfiction writing

Add an Educational History & Current Affairs style: accessible explanations, dry wit,
historical context, evidence, and clearly distinguished interpretation. Never invent
people, scenes, dialogue, quotations, statistics, or citations in this style.

Persist style in project settings and apply it to outlines, drafts, automatic polish,
and manual edits. Carry special instructions through all stages. Existing projects
default to Balanced. Keep the existing visual design and accessible native controls.

Automatic research uses the free English Wikipedia API, with an explicit topic,
retrieval date, revision metadata, source links, and extracted text saved as project
materials. This is background research, not comprehensive news or primary-source
verification. Users can add primary data as notes. Missing evidence is identified;
retrieval failure stops generation instead of silently substituting model memory.
Reuse saved research across chapters; explicit refresh replaces only fetched research.
All AI calls remain on OpenRouter free models, with zero maximum model prices and
no paid search plugins. No additional API keys or dependencies are required.

Implementation order: prompt contracts and tests; research retrieval and tests;
project UI and generation wiring; runtime verification.

Commands: `npm test`, `npm run typecheck`, `npm run build`, `npm run dev`.
TypeScript modules live in services/, React components in components/, tests in tests/.
Use node:test through the existing tsx dependency, mock network boundaries, and verify
the saved-style/research workflow in an isolated browser. Preserve existing content.

Example: `settings: { writingStyle: 'educational_nonfiction' }`.
Never claim a retrieved page independently verifies every assertion or is current
merely because it was retrieved today. Do not change deployment or authentication.

## Art generation additions

Fix chapter illustrations using a free OpenRouter model to produce a chapter-specific
SVG. Never silently replace failures with the deterministic landscape template.
Provide regenerate and remove controls; preserve existing art if regeneration fails.
Sanitize SVG to static drawing primitives and reject malformed or empty drawings.

Save a cover-art prompt in project settings and a separate illustration prompt on
each chapter. Include these instructions in generation and regeneration, alongside
book/chapter context. Expose prompts in both the outline and reader where relevant.
All art requests use free text models for SVG vector output; no paid image models.

## Verification

- 31 node:test checks cover prompt propagation, full editing instructions, research
  retrieval/failure cases, server and browser free-model routing, and art direction.
- Chromium workflow checks cover saved style/research/art prompts after reload,
  research failures, outline-to-manuscript navigation, rendered SVG dimensions,
  regeneration success/failure, nonfiction edit tools, and SVG sanitization.
- Reader layouts checked at 320, 768, 1024, and 1440 pixels. Mobile cover settings
  open and close above the app header; new controls have accessible labels.
- Live Wikipedia retrieval verified through the local API. Model responses were
  mocked for browser/integration checks because no local OpenRouter key is configured.
  Live model output quality and rate-limit behavior remain unverified locally.
- Production build and TypeScript checks pass. Existing build warnings concern a
  missing index.css reference and large output chunks.

## Server startup regression

The API's extensionless research-module import worked under tsx but failed after
compilation under native Node ESM. Use emitted `.js` extensions for the API's local
runtime dependencies. The native-runtime test transpiles the API and its dependencies
into a temporary module package and invokes health/research without tsx.

Generation configuration, research, and OpenRouter responses are parsed defensively:
plain-text/HTML server failures retain a useful HTTP status and retry instruction,
instead of throwing a JSON syntax error or being mistaken for a missing API key.

## Uploaded artwork (supersedes in-app SVG generation)

Keep AI writing on free models. Replace the art-generation controls with local image
uploads in the outline and reader: upload/replace/remove a cover and an illustration
for each chapter. Preserve existing images and saved art-direction notes. Notes can
be used with an external art tool; changing them does not alter the uploaded image.
No new image service, paid model, or server upload endpoint is introduced.

Accept PNG, JPEG, and WebP up to 15 MB; validate signatures and decode images before
replacing saved art. Preserve proportions and optimize large images to a maximum
2400-pixel edge as high-quality JPEG for storage and existing PDF/EPUB exports.
Reject corrupt, unsupported, or oversized files without losing the previous image.
Persist through the existing project storage/sync. Check exports and phone/desktop
upload flows, including replacing/removing images and reselecting the same file.

Verification: Chromium exercised PNG/JPEG/WebP uploads, corrupt/disguised/oversized
files, replacement/removal, same-file reselection, independent chapter images, and
persistence after reload. No AI endpoint was called during artwork operations.
Reader layouts and cover settings checked at 320/768/1024/1440 pixels. PDF and EPUB
checks include a cover plus two chapter images; PDF artwork is fitted proportionally
inside its frame rather than stretched, with higher-resolution rasterization.
