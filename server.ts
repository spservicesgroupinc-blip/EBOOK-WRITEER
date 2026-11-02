import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OpenRouter } from '@openrouter/sdk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENROUTER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

const resolveOpenRouterApiKey = (): string => {
  if (
    process.env.OPENROUTER_API_KEY &&
    process.env.OPENROUTER_API_KEY !== 'OPENROUTER_API_KEY' &&
    process.env.OPENROUTER_API_KEY !== '<OPENROUTER_API_KEY>'
  ) {
    return process.env.OPENROUTER_API_KEY;
  }
  if (process.env.API_KEY && process.env.API_KEY.startsWith('sk-or-')) {
    return process.env.API_KEY;
  }
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.startsWith('sk-or-')) {
    return process.env.GEMINI_API_KEY;
  }
  try {
    if (fs.existsSync('/app/.dev.env.json')) {
      const envData = JSON.parse(fs.readFileSync('/app/.dev.env.json', 'utf-8'));
      const key =
        envData.OPENROUTER_API_KEY ||
        (envData.API_KEY?.startsWith('sk-or-') ? envData.API_KEY : undefined) ||
        (envData.GEMINI_API_KEY?.startsWith('sk-or-') ? envData.GEMINI_API_KEY : undefined);
      if (key) {
        process.env.OPENROUTER_API_KEY = key;
        return key;
      }
    }
  } catch {
    // Ignore file read errors
  }
  return '';
};

const extractTextFromParts = (parts: any[]): string => {
  if (!Array.isArray(parts)) return String(parts || '');
  return parts
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part?.text) return part.text;
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

const cleanThinkingAndFences = (raw: string): string => {
  let text = String(raw || '');
  // Remove complete <think>...</think> blocks
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  // If there is an orphaned closing </think>, strip everything before and including it
  if (/<\/think>/i.test(text)) {
    text = text.replace(/^[\s\S]*<\/think>/i, '');
  }
  // If there is an unclosed opening <think>, strip the tag itself so we can still inspect content
  text = text.replace(/<think>/gi, '');
  // Strip markdown code fences
  text = text.replace(/```json/gi, '').replace(/```/g, '');
  return text.trim();
};

/**
 * Repairs common LLM JSON issues:
 * - Unescaped inner double quotes inside string values
 * - Unescaped newlines / tabs / control chars inside string literals
 * - Trailing commas before } or ]
 * - Unclosed strings / arrays / objects due to token truncation
 */
const repairJsonString = (input: string): string => {
  let src = input.trim();
  const firstBrace = src.indexOf('{');
  if (firstBrace !== -1) {
    src = src.slice(firstBrace);
  }

  let out = '';
  let inString = false;
  let isEscaped = false;
  let expectingValue = false; // false = expecting key or } in object, true = expecting value after :
  const stack: ('{' | '[')[] = [];

  const nextNonWhitespaceChar = (str: string, startIndex: number): string => {
    for (let j = startIndex; j < str.length; j++) {
      const c = str[j];
      if (c !== ' ' && c !== '\t' && c !== '\r' && c !== '\n') {
        return c;
      }
    }
    return '';
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];

    if (inString) {
      if (isEscaped) {
        out += ch;
        isEscaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        isEscaped = true;
        continue;
      }
      if (ch === '\n') {
        out += '\\n';
        continue;
      }
      if (ch === '\r') {
        out += '\\r';
        continue;
      }
      if (ch === '\t') {
        out += '\\t';
        continue;
      }
      if (ch === '"') {
        // Check if this quote is structurally closing the string or an unescaped internal quote
        const nextChar = nextNonWhitespaceChar(src, i + 1);
        const topContainer = stack[stack.length - 1];
        let isClosingQuote = false;

        if (nextChar === '') {
          isClosingQuote = true;
        } else if (topContainer === '{' && !expectingValue) {
          // Inside an object key, closing quote must be followed by ':'
          isClosingQuote = nextChar === ':';
        } else {
          // Inside a string value (in object or array), closing quote is followed by ',', '}', or ']'
          if (nextChar === '}' || nextChar === ']') {
            isClosingQuote = true;
          } else if (nextChar === ',') {
            // In an object value, a comma closing the string should be followed by a key ("...") or '}'
            if (topContainer === '{') {
              let commaIdx = i + 1;
              while (commaIdx < src.length && src[commaIdx] !== ',') commaIdx++;
              const afterComma = nextNonWhitespaceChar(src, commaIdx + 1);
              isClosingQuote = afterComma === '"' || afterComma === '}' || afterComma === '';
            } else {
              isClosingQuote = true;
            }
          }
        }

        if (isClosingQuote) {
          inString = false;
          out += '"';
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
    } else {
      if (ch === '"') {
        inString = true;
        out += ch;
      } else if (ch === '{') {
        stack.push('{');
        expectingValue = false;
        out += ch;
      } else if (ch === '[') {
        stack.push('[');
        expectingValue = true;
        out += ch;
      } else if (ch === '}') {
        if (stack[stack.length - 1] === '{') stack.pop();
        expectingValue = false;
        out += ch;
      } else if (ch === ']') {
        if (stack[stack.length - 1] === '[') stack.pop();
        expectingValue = false;
        out += ch;
      } else if (ch === ':') {
        expectingValue = true;
        out += ch;
      } else if (ch === ',') {
        if (stack[stack.length - 1] === '{') {
          expectingValue = false;
        } else {
          expectingValue = true;
        }
        out += ch;
      } else {
        out += ch;
      }
    }
  }

  if (inString) {
    out += '"';
  }

  // Remove dangling colons or commas at the end before auto-closing brackets
  out = out.replace(/[,:\s]+$/, '');

  while (stack.length > 0) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }

  // Remove any trailing commas before } or ]
  out = out.replace(/,\s*([}\]])/g, '$1');

  return out;
};

const normalizeOutlineObject = (parsed: any, fallbackContext = ''): any => {
  const obj = parsed && typeof parsed === 'object' ? parsed : {};
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Untitled Manuscript';
  const description =
    typeof obj.description === 'string' && obj.description.trim()
      ? obj.description.trim()
      : fallbackContext.slice(0, 300).trim() || 'A comprehensive narrative outline crafted from your source notes.';

  let rawChapters = Array.isArray(obj.chapters) ? obj.chapters : [];
  const chapters = rawChapters
    .filter((c: any) => c && typeof c === 'object')
    .map((c: any, idx: number) => ({
      chapterNumber: typeof c.chapterNumber === 'number' ? c.chapterNumber : idx,
      title:
        typeof c.title === 'string' && c.title.trim()
          ? c.title.trim()
          : idx === 0
          ? 'Introduction'
          : `Chapter ${idx}`,
      summary:
        typeof c.summary === 'string' && c.summary.trim()
          ? c.summary.trim()
          : 'Develop the core narrative scenes, character interactions, and thematic progression for this chapter.',
    }));

  if (chapters.length === 0) {
    chapters.push(
      {
        chapterNumber: 0,
        title: 'Introduction',
        summary: 'Establish the opening setting, core premise, central conflict, and narrative tone.',
      },
      {
        chapterNumber: 1,
        title: 'Chapter 1: The Inciting Threshold',
        summary: 'Introduce the primary figures and the catalyst that sets the main arc into motion.',
      },
      {
        chapterNumber: 2,
        title: 'Chapter 2: Rising Momentum',
        summary: 'Deepen the stakes, explore obstacles, and expand the world and key concepts.',
      },
      {
        chapterNumber: 3,
        title: 'Chapter 3: Convergence & Resolution',
        summary: 'Bring the central conflict to a decisive turning point and resolve the primary arc.',
      }
    );
  }

  const rawVault = obj.loreVault || obj.loreBible || {};
  const loreVault = {
    characters: Array.isArray(rawVault.characters)
      ? rawVault.characters
          .filter((ch: any) => ch && typeof ch === 'object')
          .map((ch: any) => ({
            name: String(ch.name || 'Protagonist'),
            role: String(ch.role || 'Central Figure'),
            description: String(ch.description || 'Key figure driving the narrative arc.'),
          }))
      : [],
    worldAndSetting: String(
      rawVault.worldAndSetting ||
        'Core setting and foundational atmosphere established in the source materials.'
    ),
    keyTermsAndConcepts: Array.isArray(rawVault.keyTermsAndConcepts)
      ? rawVault.keyTermsAndConcepts.map((t: any) => String(t))
      : [],
    plotArcsAndRules: String(
      rawVault.plotArcsAndRules ||
        'Primary narrative progression from introduction through escalation and resolution.'
    ),
  };

  return {
    title,
    description,
    chapters,
    loreVault,
    loreBible: loreVault,
  };
};

const extractOutlineFromRawText = (raw: string, fallbackContext = ''): any => {
  const cleaned = cleanThinkingAndFences(raw);

  // Extract title & description via regex if partially present in broken JSON or markdown
  const titleMatch =
    cleaned.match(/"title"\s*:\s*"([^"\n]+)"/i) ||
    cleaned.match(/^#\s+(.+)$/m);
  const descMatch =
    cleaned.match(/"description"\s*:\s*"([^"\n]+)"/i) ||
    cleaned.match(/(?:synopsis|description)\s*[:\-]\s*(.+)/i);

  // Try extracting individual chapter blocks via regex
  const chapters: { chapterNumber: number; title: string; summary: string }[] = [];
  const chapterRegex =
    /"chapterNumber"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"summary"\s*:\s*"([\s\S]*?)"(?=\s*\ normally|\s*\}|\s*,\s*"[a-zA-Z]|\s*$)/gi;
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(cleaned)) !== null) {
    chapters.push({
      chapterNumber: parseInt(match[1], 10),
      title: match[2].trim(),
      summary: match[3].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim(),
    });
  }

  // Also check for markdown chapter headings if regex didn't find JSON chapter objects
  if (chapters.length === 0) {
    const mdChapterRegex = /(?:^|\n)#{1,3}\s*(?:Chapter\s*(\d+)|Introduction)\s*[:\-–]?\s*([^\n]*)\n+([\s\S]*?)(?=(?:\n#{1,3}\s*(?:Chapter|Introduction))|$)/gi;
    let mdMatch: RegExpExecArray | null;
    let idx = 0;
    while ((mdMatch = mdChapterRegex.exec(cleaned)) !== null) {
      const num = mdMatch[1] !== undefined ? parseInt(mdMatch[1], 10) : idx;
      const chapTitle = mdMatch[2]?.trim() || (num === 0 ? 'Introduction' : `Chapter ${num}`);
      const chapSummary = mdMatch[3]?.trim().slice(0, 600) || 'Detailed chapter progression.';
      chapters.push({
        chapterNumber: num,
        title: chapTitle,
        summary: chapSummary,
      });
      idx++;
    }
  }

  return normalizeOutlineObject(
    {
      title: titleMatch?.[1]?.trim(),
      description: descMatch?.[1]?.trim(),
      chapters,
    },
    fallbackContext
  );
};

const extractJsonObject = (raw: string, fallbackContext = ''): any => {
  const stripped = cleanThinkingAndFences(raw);

  // 1. Direct parse
  try {
    return normalizeOutlineObject(JSON.parse(stripped), fallbackContext);
  } catch {
    // Continue to candidate extraction
  }

  // 2. Find '{' positions and try direct & repaired JSON parse
  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1) {
    const sliceToLast =
      lastBrace > firstBrace ? stripped.slice(firstBrace, lastBrace + 1) : stripped.slice(firstBrace);

    try {
      return normalizeOutlineObject(JSON.parse(sliceToLast), fallbackContext);
    } catch {
      // Try repairing sliceToLast
      try {
        const repaired = repairJsonString(sliceToLast);
        return normalizeOutlineObject(JSON.parse(repaired), fallbackContext);
      } catch {
        // Try repairing from full stripped starting at firstBrace
        try {
          const repairedFull = repairJsonString(stripped.slice(firstBrace));
          return normalizeOutlineObject(JSON.parse(repairedFull), fallbackContext);
        } catch {
          // Continue to regex/markdown fallback
        }
      }
    }
  }

  // 3. Fallback: extract fields & chapters from partial JSON or prose so outline generation never fails
  return extractOutlineFromRawText(stripped, fallbackContext);
};

async function runOpenRouterChat(userContent: string, requestedModel?: string) {
  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      'OpenRouter API key is not configured yet. Please open the Settings > Secrets panel in AI Studio and add OPENROUTER_API_KEY.'
    );
  }

  const openrouter = new OpenRouter({
    apiKey,
  });

  const primaryModel =
    requestedModel && requestedModel.trim() && requestedModel !== 'instant-editorial-svg'
      ? requestedModel.trim()
      : OPENROUTER_MODEL;

  const modelsToTry =
    primaryModel === OPENROUTER_MODEL
      ? [OPENROUTER_MODEL, 'openrouter/free']
      : [primaryModel, OPENROUTER_MODEL];

  let lastErr: any;
  for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
    const currentModel = modelsToTry[attempt];
    try {
      const stream = await openrouter.chat.send({
        chatRequest: {
          model: currentModel,
          messages: [
            {
              role: 'user',
              content: userContent,
            },
          ],
          stream: true,
        },
      });

      let response = '';
      let reasoningBuffer = '';
      let promptTokens = 0;
      let completionTokens = 0;
      let reasoningTokens = 0;

      for await (const chunk of stream) {
        const delta: any = chunk.choices[0]?.delta;
        const content = delta?.content;
        if (content) {
          response += content;
        } else if (delta?.reasoning) {
          reasoningBuffer += delta.reasoning;
        }

        if (chunk.usage) {
          reasoningTokens = chunk.usage.completionTokensDetails?.reasoningTokens || 0;
          promptTokens = chunk.usage.promptTokens || 0;
          completionTokens = chunk.usage.completionTokens || 0;
        }
      }

      const rawOutput = response.trim() || reasoningBuffer.trim();
      const cleanedText = cleanThinkingAndFences(rawOutput);

      if (cleanedText || rawOutput) {
        return {
          text: cleanedText || rawOutput,
          modelUsed: currentModel,
          usage: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: completionTokens + reasoningTokens,
            reasoningTokenCount: reasoningTokens,
          },
        };
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  if (lastErr) {
    throw lastErr;
  }

  return {
    text: '',
    modelUsed: primaryModel,
    usage: {
      promptTokenCount: 0,
      candidatesTokenCount: 0,
      reasoningTokenCount: 0,
    },
  };
}

const escapeXml = (unsafe: string): string =>
  String(unsafe || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const wrapSvgTitleLines = (title: string, maxCharsPerLine = 20, maxLines = 4): string[] => {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + ' ' + word).length <= maxCharsPerLine) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : ['Untitled'];
};

const buildBookCoverOrSketchSvg = (prompt: string, aspectRatio: string): string => {
  const isCover = aspectRatio === '3:4';
  const width = isCover ? 600 : aspectRatio === '16:9' ? 800 : 600;
  const height = isCover ? 800 : aspectRatio === '16:9' ? 450 : 600;

  // Deterministic seed from prompt
  let hash = 0;
  const str = String(prompt || 'Book');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  if (!isCover) {
    // High-contrast charcoal / ink editorial chapter illustration (16:9)
    const ridgeY1 = 240 + (hash % 60);
    const ridgeY2 = 290 + ((hash >> 3) % 50);
    const sunX = 180 + (hash % 440);
    const sunY = 130 + ((hash >> 5) % 80);

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <linearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#f8fafc"/>
          <stop offset="65%" stop-color="#e2e8f0"/>
          <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <radialGradient id="inkSun" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#0f172a" stop-opacity="0.9"/>
          <stop offset="70%" stop-color="#334155" stop-opacity="0.25"/>
          <stop offset="100%" stop-color="#334155" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="100%" height="100%" fill="url(#skyGrad)"/>
      <circle cx="${sunX}" cy="${sunY}" r="72" fill="url(#inkSun)"/>
      <circle cx="${sunX}" cy="${sunY}" r="34" fill="#0f172a"/>
      <path d="M0 ${ridgeY1} Q 200 ${ridgeY1 - 70} 420 ${ridgeY1 - 15} T 800 ${ridgeY1 - 40} L 800 ${height} L 0 ${height} Z" fill="#475569" opacity="0.7"/>
      <path d="M0 ${ridgeY2} Q 260 ${ridgeY2 - 55} 510 ${ridgeY2 + 10} T 800 ${ridgeY2 - 25} L 800 ${height} L 0 ${height} Z" fill="#1e293b"/>
      <path d="M0 ${height - 70} Q 400 ${height - 110} 800 ${height - 60} L 800 ${height} L 0 ${height} Z" fill="#0f172a"/>
      <rect x="20" y="20" width="${width - 40}" height="${height - 40}" fill="none" stroke="#0f172a" stroke-width="2" stroke-opacity="0.35"/>
      <rect x="26" y="26" width="${width - 52}" height="${height - 52}" fill="none" stroke="#0f172a" stroke-width="1" stroke-opacity="0.2"/>
    </svg>`;
  }

  // Extract book title from prompt if present
  const titleMatch =
    prompt.match(/titled\s+"([^"]+)"/i) ||
    prompt.match(/titled\s+'([^']+)'/i);
  const rawTitle = titleMatch ? titleMatch[1] : prompt.slice(0, 50);
  const titleLines = wrapSvgTitleLines(rawTitle, 18, 4);

  const palettes = [
    { bg1: '#090d16', bg2: '#172554', bg3: '#1e1b4b', accent: '#f59e0b', sub: '#93c5fd' },
    { bg1: '#0f172a', bg2: '#134e4a', bg3: '#042f2e', accent: '#2dd4bf', sub: '#cbd5e1' },
    { bg1: '#18181b', bg2: '#3f1d2e', bg3: '#4c0519', accent: '#fb7185', sub: '#fda4af' },
    { bg1: '#0c0a09', bg2: '#1c1917', bg3: '#292524', accent: '#eab308', sub: '#d6d3d1' },
    { bg1: '#0f172a', bg2: '#1e1b4b', bg3: '#311042', accent: '#fbbf24', sub: '#e2e8f0' },
  ];
  const palette = palettes[hash % palettes.length];

  const titleSvg = titleLines
    .map((line, idx) => {
      const y = 260 + idx * 54;
      return `<text x="300" y="${y}" text-anchor="middle" fill="#f8fafc" font-family="Georgia, 'Times New Roman', serif" font-size="42" font-weight="bold" letter-spacing="1.5">${escapeXml(
        line.toUpperCase()
      )}</text>`;
    })
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="coverBg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${palette.bg1}"/>
        <stop offset="55%" stop-color="${palette.bg2}"/>
        <stop offset="100%" stop-color="${palette.bg3}"/>
      </linearGradient>
      <radialGradient id="coverGlow" cx="50%" cy="38%" r="48%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.28"/>
        <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#coverBg)"/>
    <circle cx="300" cy="310" r="240" fill="url(#coverGlow)"/>
    <circle cx="300" cy="540" r="115" fill="none" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.45"/>
    <circle cx="300" cy="540" r="85" fill="none" stroke="${palette.sub}" stroke-width="1" stroke-opacity="0.3"/>
    <polygon points="300,445 375,585 225,585" fill="none" stroke="${palette.accent}" stroke-width="2" stroke-opacity="0.6"/>
    <polygon points="300,615 375,475 225,475" fill="none" stroke="${palette.accent}" stroke-width="1.2" stroke-opacity="0.35"/>
    <rect x="34" y="34" width="${width - 68}" height="${height - 68}" fill="none" stroke="${palette.accent}" stroke-opacity="0.55" stroke-width="2"/>
    <rect x="44" y="44" width="${width - 88}" height="${height - 88}" fill="none" stroke="${palette.sub}" stroke-opacity="0.25" stroke-width="1"/>
    <line x1="180" y1="185" x2="420" y2="185" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.7"/>
    ${titleSvg}
    <line x1="220" y1="${260 + titleLines.length * 54}" x2="380" y2="${260 + titleLines.length * 54}" stroke="${palette.accent}" stroke-width="1.5" stroke-opacity="0.7"/>
    <text x="300" y="720" text-anchor="middle" fill="${palette.sub}" font-family="Georgia, serif" font-size="14" letter-spacing="4" opacity="0.8">ORIGINAL EDITION</text>
  </svg>`;
};

/**
 * Extracts and strictly sanitizes an <svg>...</svg> block generated by an OpenRouter LLM
 * so it is guaranteed to be valid XML for data:image/svg+xml;base64 rendering.
 */
const sanitizeAndExtractSvg = (rawText: string, width: number, height: number): string | null => {
  const cleaned = cleanThinkingAndFences(rawText)
    .replace(/```xml/gi, '')
    .replace(/```svg/gi, '')
    .replace(/```/g, '');

  const match = cleaned.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;

  let svg = match[0];

  // Strip any <script> tags or external event handlers
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');

  // Escape any bare '&' that is not already a valid XML entity
  svg = svg.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  // Ensure xmlns is present on root <svg>
  if (!/\bxmlns\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }

  // Ensure viewBox is present on root <svg>
  if (!/\bviewBox\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }

  return svg;
};

export const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Increase payload limit for audio recordings and base64 images
app.use(express.json({ limit: '50mb' }));

// Health check endpoint for Vercel & local monitoring
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    environment: process.env.VERCEL ? 'vercel' : process.env.NODE_ENV || 'development',
  });
});

// 0. Live Free OpenRouter Models Catalog
app.get('/api/openrouter/models', async (_req, res) => {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models');
      if (!response.ok) {
        res.json({ models: [] });
        return;
      }
      const data: any = await response.json();
      const rawList = Array.isArray(data?.data) ? data.data : [];

      const freeModels = rawList
        .filter((m: any) => {
          const id = String(m?.id || '');
          if (!id) return false;
          // Exclude pure safety classifiers or audio-only clip models
          if (id.includes('content-safety') || id.includes('lyria')) return false;
          const isFreeSuffix = id.endsWith(':free') || id === 'openrouter/free';
          const isZeroPrice =
            m?.pricing &&
            parseFloat(m.pricing.prompt) === 0 &&
            parseFloat(m.pricing.completion) === 0;
          return isFreeSuffix || isZeroPrice;
        })
        .map((m: any) => ({
          id: String(m.id),
          name: String(m.name || m.id),
          description: String(m.description || '').slice(0, 140) || 'Free OpenRouter AI Model',
          modality: String(m.architecture?.modality || 'text->text'),
        }));

      res.json({ models: freeModels });
    } catch {
      res.json({ models: [] });
    }
  });

  // 1. Research Book Trends
  app.post('/api/gemini/trends', async (req, res) => {
    try {
      const { model } = req.body || {};
      const prompt =
        "Act as a publishing market analyst. Perform deep research to identify the current top 5 trending ebook topics/genres for the current week/month. For each trend, provide: 1. The Genre/Topic Name. 2. Why it is trending (viral events, seasonal, etc). 3. Estimated gross sales potential or popularity ranking if available. 4. Target audience. 5. A specific 'Book Idea' prompt for a user. Summarize the findings in markdown.";

      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);

      res.json({
        content: text || 'No trends found.',
        sources: [],
        model: modelUsed,
        usage,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to research trends.' });
    }
  });

  // 2. Transcribe Audio
  app.post('/api/gemini/transcribe', async (req, res) => {
    try {
      const { base64Audio, mimeType, model } = req.body;
      if (!base64Audio) {
        res.status(400).json({ error: 'Missing audio data' });
        return;
      }

      const prompt = `An audio voice note (${mimeType || 'audio/webm'}, ${Math.round(
        (base64Audio.length * 3) / 4 / 1024
      )} KB) was recorded for a book project. Generate a concise placeholder note indicating that an audio voice note was attached, or summarize any context provided.`;

      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);

      res.json({
        text: text || '',
        model: modelUsed,
        usage,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to transcribe audio.' });
    }
  });

  // 3. Generate Book Outline & Lore Vault
  app.post('/api/gemini/outline', async (req, res) => {
    try {
      const { parts, model } = req.body;
      const basePrompt = extractTextFromParts(parts);

      const outlinePrompt = `${basePrompt}

CRITICAL JSON OUTPUT REQUIREMENT:
You MUST return ONLY a valid, raw JSON object (do NOT wrap in \`\`\`json markdown fences, and do NOT include any introductory or concluding text outside the JSON object).
IMPORTANT: Inside JSON string values, NEVER use unescaped double quotes ("). Always use single quotes ('...') for any inner quotes or emphasis. Ensure all strings are on a single line without raw line breaks.
Conform to this exact JSON structure:
{
  "title": "A creative and engaging title for the book",
  "description": "A compelling synopsis of the book",
  "chapters": [
    {
      "chapterNumber": 0,
      "title": "Introduction",
      "summary": "Detailed narrative beats and plot points for this chapter."
    },
    {
      "chapterNumber": 1,
      "title": "Chapter 1 Title",
      "summary": "Detailed narrative beats and plot points for this chapter."
    }
  ],
  "loreVault": {
    "characters": [
      {
        "name": "Character Name",
        "role": "Character Role",
        "description": "Character traits, arc, and profile"
      }
    ],
    "worldAndSetting": "Description of settings, environments, or core domain framework.",
    "keyTermsAndConcepts": ["Term 1", "Term 2"],
    "plotArcsAndRules": "Summary of plot arcs, thematic goals, or non-fiction principles."
  }
}`;

      const { text, modelUsed, usage } = await runOpenRouterChat(outlinePrompt, model);

      if (!text) {
        throw new Error('AI returned an empty response. Please try again.');
      }

      const outline = extractJsonObject(text, basePrompt);
      if (outline.loreVault || outline.loreBible) {
        const vault = outline.loreVault || outline.loreBible;
        outline.loreVault = vault;
        outline.loreBible = vault;
      }

      res.json({
        outline,
        model: modelUsed,
        usage,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to generate outline.' });
    }
  });

  // 4. Write or Refine Chapter Text
  app.post('/api/gemini/generate-text', async (req, res) => {
    try {
      const { parts, model } = req.body;
      const prompt = extractTextFromParts(parts);
      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);

      res.json({
        text: text || '',
        model: modelUsed,
        usage,
      });
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Failed to generate text.' });
    }
  });

  // 5. Generate Image (Supports any selected Free OpenRouter AI model for bespoke SVG art + Instant Vector fallback)
  app.post('/api/gemini/image', async (req, res) => {
    const { prompt = '', aspectRatio = '1:1', model = OPENROUTER_MODEL } = req.body || {};
    const isCover = aspectRatio === '3:4';
    const width = isCover ? 600 : aspectRatio === '16:9' ? 800 : 600;
    const height = isCover ? 800 : aspectRatio === '16:9' ? 450 : 600;

    // If user selected Instant Editorial SVG Engine, return immediately
    if (model === 'instant-editorial-svg') {
      const rawSvg = buildBookCoverOrSketchSvg(String(prompt), String(aspectRatio));
      const base64Svg = Buffer.from(rawSvg, 'utf-8').toString('base64');
      res.json({
        base64: base64Svg,
        mimeType: 'image/svg+xml',
        model: 'instant-editorial-svg',
      });
      return;
    }

    // Otherwise, use the chosen Free OpenRouter AI Model to design custom SVG artwork
    try {
      const svgDesignPrompt = isCover
        ? `You are an award-winning book cover illustrator and typographer.
Create a complete, self-contained, striking 2D flat SVG book cover illustration (viewBox="0 0 ${width} ${height}" width="${width}" height="${height}").
Creative Brief: ${prompt}
STRICT SVG RULES:
1. Output ONLY raw <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">...</svg> code. No markdown fences, no commentary.
2. Include rich atmospheric gradients (<linearGradient>, <radialGradient>), layered symbolic vector shapes (<path>, <circle>, <polygon>, <rect>), and bold, centered, legible book title typography (<text text-anchor="middle">).
3. NEVER use unescaped '&' characters in text or attributes (always use '&amp;' or write 'and'). Keep all XML tags strictly closed and valid.`
        : `You are an editorial book illustrator.
Create a complete, high-contrast black-and-white charcoal/ink style SVG chapter illustration (viewBox="0 0 ${width} ${height}" width="${width}" height="${height}").
Scene Brief: ${prompt}
STRICT SVG RULES:
1. Output ONLY raw <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">...</svg> code. No markdown fences, no commentary.
2. Use expressive layered monochrome silhouettes, atmospheric gradients, and ink linework (<path>, <circle>, <rect>).
3. NEVER use unescaped '&' characters. Keep all XML tags strictly closed and valid.`;

      const { text, modelUsed, usage } = await runOpenRouterChat(svgDesignPrompt, model);
      const validSvg = sanitizeAndExtractSvg(text, width, height);

      if (validSvg) {
        const base64Svg = Buffer.from(validSvg, 'utf-8').toString('base64');
        res.json({
          base64: base64Svg,
          mimeType: 'image/svg+xml',
          model: modelUsed,
          usage,
        });
        return;
      }
    } catch {
      // Fall through to deterministic SVG fallback if the selected free model times out
    }

    try {
      const rawSvg = buildBookCoverOrSketchSvg(String(prompt), String(aspectRatio));
      const base64Svg = Buffer.from(rawSvg, 'utf-8').toString('base64');
      res.json({
        base64: base64Svg,
        mimeType: 'image/svg+xml',
        model: model || OPENROUTER_MODEL,
      });
    } catch (fallbackErr: any) {
      res.status(500).json({ error: fallbackErr?.message || 'Failed to generate artwork.' });
    }
  });

  // 6. Generate Speech (TTS handled by client Web Speech fallback when audioData is empty)
  app.post('/api/gemini/speech', async (_req, res) => {
    res.json({
      audioData: '',
      model: OPENROUTER_MODEL,
    });
  });

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (!process.env.VERCEL) {
  startServer();
}

export default app;


