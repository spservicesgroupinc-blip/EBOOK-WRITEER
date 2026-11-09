import fs from 'fs';
import { retrieveResearch } from '../services/wikipediaResearch.js';

const OPENROUTER_MODEL = 'google/gemma-4-26b-a4b-it:free';

const resolveOpenRouterApiKey = (): string => {
  const candidates = [
    process.env.OPENROUTER_API_KEY,
    process.env.VITE_OPENROUTER_API_KEY,
    process.env.API_KEY,
    process.env.GEMINI_API_KEY,
  ];

  for (const candidate of candidates) {
    if (
      candidate &&
      candidate.trim() !== '' &&
      candidate !== 'OPENROUTER_API_KEY' &&
      candidate !== '<OPENROUTER_API_KEY>'
    ) {
      return candidate.trim();
    }
  }

  try {
    if (fs.existsSync('/app/.dev.env.json')) {
      const envData = JSON.parse(fs.readFileSync('/app/.dev.env.json', 'utf-8'));
      const key =
        envData.OPENROUTER_API_KEY ||
        envData.VITE_OPENROUTER_API_KEY ||
        (envData.API_KEY?.startsWith('sk-or-') ? envData.API_KEY : undefined) ||
        (envData.GEMINI_API_KEY?.startsWith('sk-or-') ? envData.GEMINI_API_KEY : undefined);
      if (key) {
        process.env.OPENROUTER_API_KEY = key;
        return key;
      }
    }
  } catch {
    // Ignore file read errors in serverless environments
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
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  if (/<\/think>/i.test(text)) {
    text = text.replace(/^[\s\S]*<\/think>/i, '');
  }
  text = text.replace(/<think>/gi, '');
  text = text.replace(/```json/gi, '').replace(/```/g, '');
  return text.trim();
};

const repairJsonString = (input: string): string => {
  let src = input.trim();
  const firstBrace = src.indexOf('{');
  if (firstBrace !== -1) {
    src = src.slice(firstBrace);
  }

  let out = '';
  let inString = false;
  let isEscaped = false;
  let expectingValue = false;
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
        const nextChar = nextNonWhitespaceChar(src, i + 1);
        const topContainer = stack[stack.length - 1];
        let isClosingQuote = false;

        if (nextChar === '') {
          isClosingQuote = true;
        } else if (topContainer === '{' && !expectingValue) {
          isClosingQuote = nextChar === ':';
        } else {
          if (nextChar === '}' || nextChar === ']') {
            isClosingQuote = true;
          } else if (nextChar === ',') {
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

  out = out.replace(/[,:\s]+$/, '');

  while (stack.length > 0) {
    const open = stack.pop();
    out += open === '{' ? '}' : ']';
  }

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

  const rawChapters = Array.isArray(obj.chapters) ? obj.chapters : [];
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

  const titleMatch =
    cleaned.match(/"title"\s*:\s*"([^"\n]+)"/i) ||
    cleaned.match(/^#\s+(.+)$/m);
  const descMatch =
    cleaned.match(/"description"\s*:\s*"([^"\n]+)"/i) ||
    cleaned.match(/(?:synopsis|description)\s*[:\-]\s*(.+)/i);

  const chapters: { chapterNumber: number; title: string; summary: string }[] = [];
  const chapterRegex =
    /"chapterNumber"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"summary"\s*:\s*"([\s\S]*?)"(?=\s*\}|\s*,\s*"[a-zA-Z]|\s*$)/gi;
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(cleaned)) !== null) {
    chapters.push({
      chapterNumber: parseInt(match[1], 10),
      title: match[2].trim(),
      summary: match[3].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim(),
    });
  }

  if (chapters.length === 0) {
    const mdChapterRegex =
      /(?:^|\n)#{1,3}\s*(?:Chapter\s*(\d+)|Introduction)\s*[:\-–]?\s*([^\n]*)\n+([\s\S]*?)(?=(?:\n#{1,3}\s*(?:Chapter|Introduction))|$)/gi;
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

  try {
    return normalizeOutlineObject(JSON.parse(stripped), fallbackContext);
  } catch {
    // Continue
  }

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1) {
    const sliceToLast =
      lastBrace > firstBrace ? stripped.slice(firstBrace, lastBrace + 1) : stripped.slice(firstBrace);

    try {
      return normalizeOutlineObject(JSON.parse(sliceToLast), fallbackContext);
    } catch {
      try {
        const repaired = repairJsonString(sliceToLast);
        return normalizeOutlineObject(JSON.parse(repaired), fallbackContext);
      } catch {
        try {
          const repairedFull = repairJsonString(stripped.slice(firstBrace));
          return normalizeOutlineObject(JSON.parse(repairedFull), fallbackContext);
        } catch {
          // Continue
        }
      }
    }
  }

  return extractOutlineFromRawText(stripped, fallbackContext);
};

async function runOpenRouterChat(userContent: string, requestedModel?: string) {
  if (requestedModel && requestedModel !== 'openrouter/free' && !requestedModel.endsWith(':free')) {
    throw new Error('Only OpenRouter free models are supported. Select a free model.');
  }
  const apiKey = resolveOpenRouterApiKey();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is missing. In Vercel, go to Project Settings -> Environment Variables, add OPENROUTER_API_KEY, and redeploy.'
    );
  }

  const primaryModel =
    requestedModel && requestedModel.trim() && requestedModel !== 'instant-editorial-svg'
      ? requestedModel.trim()
      : OPENROUTER_MODEL;

  const candidateModels = Array.from(
    new Set([
      primaryModel,
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3.5-lightning:free',
      'google/gemma-4-31b-it:free',
      'openrouter/free',
    ])
  );

  const startTime = Date.now();
  let lastErr: any;

  for (let i = 0; i < candidateModels.length; i++) {
    // Stop trying more models if we're approaching Vercel's serverless timeout
    if (Date.now() - startTime > 38000) {
      break;
    }

    const currentModel = candidateModels[i];
    // Give the first model 16s and subsequent fallback models 12s so we never hit a 504 timeout
    const perModelTimeoutMs = i === 0 ? 16000 : 12000;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), perModelTimeoutMs);

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://ebook-ai.vercel.app',
          'X-Title': 'Ebook.AI',
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            {
              role: 'user',
              content: userContent,
            },
          ],
          provider: {
            sort: 'throughput',
            max_price: { prompt: 0, completion: 0 },
          },
          reasoning: {
            effort: 'low',
            exclude: true,
          },
          stream: false,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const rawBody = await response.text();
      let data: any = {};
      try {
        data = JSON.parse(rawBody);
      } catch {
        throw new Error(`OpenRouter returned non-JSON response (HTTP ${response.status})`);
      }

      if (!response.ok || data?.error) {
        const msg = data?.error?.message || `OpenRouter HTTP ${response.status}`;
        throw new Error(msg);
      }

      const messageObj = data?.choices?.[0]?.message;
      const content = String(messageObj?.content || messageObj?.reasoning || '').trim();
      const cleanedText = cleanThinkingAndFences(content);

      const usage = data?.usage || {};
      const promptTokens = Number(usage.prompt_tokens || usage.promptTokens || 0);
      const completionTokens = Number(usage.completion_tokens || usage.completionTokens || 0);

      if (cleanedText || content) {
        return {
          text: cleanedText || content,
          modelUsed: data?.model || currentModel,
          usage: {
            promptTokenCount: promptTokens,
            candidatesTokenCount: completionTokens,
            reasoningTokenCount: 0,
          },
        };
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('All free OpenRouter models were busy. Please try again.');
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

  let hash = 0;
  const str = String(prompt || 'Book');
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }

  if (!isCover) {
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
    <text x="300" y="720" text-anchor="middle" fill="${palette.sub}" font-family="Georgia, serif" font-size="14" letter-spacing="4" opacity="0.8">EBOOK.AI EDITION</text>
  </svg>`;
};

const sanitizeAndExtractSvg = (rawText: string, width: number, height: number): string | null => {
  const cleaned = cleanThinkingAndFences(rawText)
    .replace(/```xml/gi, '')
    .replace(/```svg/gi, '')
    .replace(/```/g, '');

  const match = cleaned.match(/<svg[\s\S]*?<\/svg>/i);
  if (!match) return null;

  let svg = match[0];
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;');

  if (!/\bxmlns\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"');
  }
  if (!/\bviewBox\s*=/i.test(svg)) {
    svg = svg.replace(/^<svg\b/i, `<svg viewBox="0 0 ${width} ${height}"`);
  }

  return svg;
};

async function parseJsonBody(req: any): Promise<any> {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk: any) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function sendJson(res: any, statusCode: number, payload: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

export default async function handler(req: any, res: any) {
  const url = String(req.originalUrl || req.url || '');

  try {
    // Health check
    if (url.includes('/health')) {
      return sendJson(res, 200, {
        status: 'ok',
        hasApiKey: Boolean(resolveOpenRouterApiKey()),
        environment: process.env.VERCEL ? 'vercel' : process.env.NODE_ENV || 'development',
      });
    }

    // Fast token endpoint (<2ms) so client can bypass Vercel serverless timeout for long generations
    if (url.includes('/client-config')) {
      const apiKey = resolveOpenRouterApiKey();
      return sendJson(res, 200, {
        apiKey,
        defaultModel: OPENROUTER_MODEL,
      });
    }

    // 0. Live Free OpenRouter Models Catalog
    if (url.includes('/openrouter/models')) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/models');
        if (!response.ok) {
          return sendJson(res, 200, { models: [] });
        }
        const data: any = await response.json();
        const rawList = Array.isArray(data?.data) ? data.data : [];

        const freeModels = rawList
          .filter((m: any) => {
            const id = String(m?.id || '');
            if (!id) return false;
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

        return sendJson(res, 200, { models: freeModels });
      } catch {
        return sendJson(res, 200, { models: [] });
      }
    }

    const body = await parseJsonBody(req);

    // Free public background research, independent of OpenRouter model/search billing.
    if (url.split('?')[0].endsWith('/research')) {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST for research.' });
      if (typeof body?.topic !== 'string' || !body.topic.trim() || body.topic.trim().length > 200) {
        return sendJson(res, 400, { error: 'Enter a research topic of 1 to 200 characters.' });
      }
      try {
        return sendJson(res, 200, await retrieveResearch(body.topic));
      } catch (error: any) {
        return sendJson(res, 502, { error: error?.name === 'TimeoutError' ? 'Research timed out. Please retry.' : error?.message || 'Research is unavailable. Please retry.' });
      }
    }

    // 1. Research Book Trends
    if (url.includes('/gemini/trends')) {
      const { model } = body || {};
      const prompt =
        "Act as a publishing market analyst. Perform deep research to identify the current top 5 trending ebook topics/genres for the current week/month. For each trend, provide: 1. The Genre/Topic Name. 2. Why it is trending (viral events, seasonal, etc). 3. Estimated gross sales potential or popularity ranking if available. 4. Target audience. 5. A specific 'Book Idea' prompt for a user. Summarize the findings in markdown.";

      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);
      return sendJson(res, 200, {
        content: text || 'No trends found.',
        sources: [],
        model: modelUsed,
        usage,
      });
    }

    // 2. Transcribe Audio
    if (url.includes('/gemini/transcribe')) {
      const { base64Audio, mimeType, model } = body || {};
      if (!base64Audio) {
        return sendJson(res, 400, { error: 'Missing audio data' });
      }

      const prompt = `An audio voice note (${mimeType || 'audio/webm'}, ${Math.round(
        (base64Audio.length * 3) / 4 / 1024
      )} KB) was recorded for a book project. Generate a concise placeholder note indicating that an audio voice note was attached, or summarize any context provided.`;

      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);
      return sendJson(res, 200, {
        text: text || '',
        model: modelUsed,
        usage,
      });
    }

    // 3. Generate Book Outline & Lore Vault
    if (url.includes('/gemini/outline')) {
      const { parts, model } = body || {};
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
      "summary": "Specific chapter goals, development, available evidence and gaps where applicable."
    },
    {
      "chapterNumber": 1,
      "title": "Chapter 1 Title",
      "summary": "Specific chapter goals, development, available evidence and gaps where applicable."
    }
  ],
  "loreVault": {
    "characters": [
      {
        "name": "Documented person, institution, or fictional character as appropriate",
        "role": "Character Role",
        "description": "Source-grounded role and profile; do not invent real-world biographical details"
      }
    ],
    "worldAndSetting": "Description of settings, environments, or core domain framework.",
    "keyTermsAndConcepts": ["Term 1", "Term 2"],
    "plotArcsAndRules": "Summary of plot arcs, thematic goals, or non-fiction principles."
  }
}`;

      const { text, modelUsed, usage } = await runOpenRouterChat(outlinePrompt, model);
      if (!text) {
        return sendJson(res, 500, { error: 'AI returned an empty response. Please try again.' });
      }

      const outline = extractJsonObject(text, basePrompt);
      if (outline.loreVault || outline.loreBible) {
        const vault = outline.loreVault || outline.loreBible;
        outline.loreVault = vault;
        outline.loreBible = vault;
      }

      return sendJson(res, 200, {
        outline,
        model: modelUsed,
        usage,
      });
    }

    // 4. Write or Refine Chapter Text
    if (url.includes('/gemini/generate-text')) {
      const { parts, model } = body || {};
      const prompt = extractTextFromParts(parts);
      const { text, modelUsed, usage } = await runOpenRouterChat(prompt, model);

      return sendJson(res, 200, {
        text: text || '',
        model: modelUsed,
        usage,
      });
    }

    // 5. Generate Image
    if (url.includes('/gemini/image')) {
      const { prompt = '', aspectRatio = '1:1', model = OPENROUTER_MODEL } = body || {};
      const isCover = aspectRatio === '3:4';
      const width = isCover ? 600 : aspectRatio === '16:9' ? 800 : 600;
      const height = isCover ? 800 : aspectRatio === '16:9' ? 450 : 600;

      if (model === 'instant-editorial-svg') {
        const rawSvg = buildBookCoverOrSketchSvg(String(prompt), String(aspectRatio));
        const base64Svg = Buffer.from(rawSvg, 'utf-8').toString('base64');
        return sendJson(res, 200, {
          base64: base64Svg,
          mimeType: 'image/svg+xml',
          model: 'instant-editorial-svg',
        });
      }

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
          return sendJson(res, 200, {
            base64: base64Svg,
            mimeType: 'image/svg+xml',
            model: modelUsed,
            usage,
          });
        }
      } catch {
        // Fall through to deterministic SVG fallback
      }

      const rawSvg = buildBookCoverOrSketchSvg(String(prompt), String(aspectRatio));
      const base64Svg = Buffer.from(rawSvg, 'utf-8').toString('base64');
      return sendJson(res, 200, {
        base64: base64Svg,
        mimeType: 'image/svg+xml',
        model: model || OPENROUTER_MODEL,
      });
    }

    // 6. Generate Speech
    if (url.includes('/gemini/speech')) {
      return sendJson(res, 200, {
        audioData: '',
        model: OPENROUTER_MODEL,
      });
    }

    return sendJson(res, 404, { error: `Unknown API route: ${url}` });
  } catch (error: any) {
    return sendJson(res, 500, {
      error: error?.message || 'Internal server error',
    });
  }
}
