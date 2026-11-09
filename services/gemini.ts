import { 
  BookOutline, 
  ChapterOutline, 
  Source, 
  SourceType, 
  WritingStyle, 
  ManuscriptPov, 
  ManuscriptTense, 
  TargetDepth, 
  LoreVault 
} from "../types";
import { buildChapterPrompt, buildOutlinePrompt, buildRefinementPrompt, formatSources, isNonfiction, type WritingOptions } from "./prompts";
import { PricingService } from "./pricing";
import { BackgroundKeeper } from "./backgroundKeeper";
import { prepareIllustrationSvg } from './illustrations';
import { readApiJson } from './http';

// Non-throttled delay via Web Worker so background tabs don't stall
const delay = (ms: number) => BackgroundKeeper.unthrottledDelay(ms);

/**
 * Converts a stored base64 string or data URL into a valid image src URL,
 * automatically detecting SVG, PNG, or JPEG payloads.
 */
export const formatImageSrc = (imgData?: string): string => {
  if (!imgData) return '';
  if (imgData.startsWith('data:')) return imgData;
  const trimmed = imgData.trim();
  // Base64 encoded '<svg' starts with 'PHN2Zy' or 'PD94bW' ('<?xml')
  if (trimmed.startsWith('PHN2Zy') || trimmed.startsWith('PD94bW')) {
    return `data:image/svg+xml;base64,${trimmed}`;
  }
  if (trimmed.startsWith('iVBOR')) {
    return `data:image/png;base64,${trimmed}`;
  }
  return `data:image/jpeg;base64,${trimmed}`;
};

let cachedApiKey: string | null = null;

async function getClientOpenRouterKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  const res = await fetch('/api/client-config');
  const data = await readApiJson(res, 'App configuration service');
  if (data?.apiKey) {
    cachedApiKey = String(data.apiKey).trim();
    return cachedApiKey;
  }
  return '';
}

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

const normalizeOutlineObject = (parsed: any, fallbackContext = ''): BookOutline => {
  const obj = parsed && typeof parsed === 'object' ? parsed : {};
  const title =
    typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : 'Untitled Manuscript';
  const description =
    typeof obj.description === 'string' && obj.description.trim()
      ? obj.description.trim()
      : fallbackContext.slice(0, 300).trim() || 'A structured book outline developed from the source materials.';

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
          : 'Develop the chapter goal using the available source material; identify missing support.',
    }));

  if (chapters.length === 0) {
    throw new Error('The model did not return a usable chapter outline. Please regenerate the structure.');
  }

  const rawVault = obj.loreVault || obj.loreBible || {};
  const loreVault: LoreVault = {
    characters: Array.isArray(rawVault.characters)
      ? rawVault.characters
          .filter((ch: any) => ch && typeof ch === 'object')
          .map((ch: any) => ({
            name: String(ch.name || 'Unnamed figure'),
            role: String(ch.role || 'Central Figure'),
            description: String(ch.description || 'Profile requires supporting source details.'),
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
        'Chapter progression and source constraints.'
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

const parseOutlineFromText = (raw: string, fallbackContext = ''): BookOutline => {
  const stripped = cleanThinkingAndFences(raw);
  try {
    return normalizeOutlineObject(JSON.parse(stripped), fallbackContext);
  } catch {}

  const firstBrace = stripped.indexOf('{');
  const lastBrace = stripped.lastIndexOf('}');
  if (firstBrace !== -1) {
    const sliceToLast =
      lastBrace > firstBrace ? stripped.slice(firstBrace, lastBrace + 1) : stripped.slice(firstBrace);
    try {
      return normalizeOutlineObject(JSON.parse(sliceToLast), fallbackContext);
    } catch {
      try {
        return normalizeOutlineObject(JSON.parse(repairJsonString(sliceToLast)), fallbackContext);
      } catch {
        try {
          return normalizeOutlineObject(
            JSON.parse(repairJsonString(stripped.slice(firstBrace))),
            fallbackContext
          );
        } catch {}
      }
    }
  }

  const titleMatch =
    stripped.match(/"title"\s*:\s*"([^"\n]+)"/i) || stripped.match(/^#\s+(.+)$/m);
  const descMatch =
    stripped.match(/"description"\s*:\s*"([^"\n]+)"/i) ||
    stripped.match(/(?:synopsis|description)\s*[:\-]\s*(.+)/i);
  const chapters: { chapterNumber: number; title: string; summary: string }[] = [];
  const chapterRegex =
    /"chapterNumber"\s*:\s*(\d+)\s*,\s*"title"\s*:\s*"([^"]+)"\s*,\s*"summary"\s*:\s*"([\s\S]*?)"(?=\s*\}|\s*,\s*"[a-zA-Z]|\s*$)/gi;
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(stripped)) !== null) {
    chapters.push({
      chapterNumber: parseInt(match[1], 10),
      title: match[2].trim(),
      summary: match[3].replace(/\\"/g, '"').replace(/\\n/g, ' ').trim(),
    });
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

async function callOpenRouterDirectFromBrowser(
  prompt: string,
  requestedModel?: string
): Promise<{ text: string; model: string; usage: { promptTokenCount: number; candidatesTokenCount: number } }> {
  if (requestedModel && requestedModel !== 'openrouter/free' && !requestedModel.endsWith(':free')) {
    throw new Error('Only OpenRouter free models are supported. Select a free writing model.');
  }
  const apiKey = await getClientOpenRouterKey();
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not configured. In Vercel, add OPENROUTER_API_KEY in Project Settings -> Environment Variables and redeploy.'
    );
  }

  const primary =
    requestedModel && requestedModel.trim() && requestedModel !== 'instant-editorial-svg'
      ? requestedModel.trim()
      : 'google/gemma-4-26b-a4b-it:free';

  const modelsToTry = Array.from(
    new Set([
      primary,
      'google/gemma-4-26b-a4b-it:free',
      'nvidia/nemotron-3.5-lightning:free',
      'google/gemma-4-31b-it:free',
      'openrouter/free',
    ])
  );

  let lastErr: any;
  for (const currentModel of modelsToTry) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : 'https://ebook-ai.vercel.app',
          'X-Title': 'Ebook.AI',
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [{ role: 'user', content: prompt }],
          provider: { sort: 'throughput', max_price: { prompt: 0, completion: 0 } },
          reasoning: { effort: 'low', exclude: true },
          stream: false,
        }),
      });

      const data = await readApiJson(response, 'OpenRouter');

      const msg = data?.choices?.[0]?.message;
      const rawText = String(msg?.content || msg?.reasoning || '').trim();
      const cleaned = cleanThinkingAndFences(rawText);

      if (cleaned || rawText) {
        const usage = data?.usage || {};
        return {
          text: cleaned || rawText,
          model: data?.model || currentModel,
          usage: {
            promptTokenCount: Number(usage.prompt_tokens || 0),
            candidatesTokenCount: Number(usage.completion_tokens || 0),
          },
        };
      }
    } catch (err: any) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('All free OpenRouter models are currently busy. Please try again.');
}

async function fetchApiJson(url: string, payload: Record<string, any>): Promise<any> {
  // For text/outline/trends/transcribe endpoints, run directly from browser to OpenRouter first
  // so Vercel serverless functions NEVER hit a 504 FUNCTION_INVOCATION_TIMEOUT!
  if (url === '/api/gemini/generate-text') {
    const prompt = extractTextFromParts(payload.parts);
    return await callOpenRouterDirectFromBrowser(prompt, payload.model);
  }

  if (url === '/api/gemini/outline') {
    const basePrompt = extractTextFromParts(payload.parts);
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
    const res = await callOpenRouterDirectFromBrowser(outlinePrompt, payload.model);
    const outline = parseOutlineFromText(res.text, basePrompt);
    return {
      outline,
      model: res.model,
      usage: res.usage,
    };
  }

  if (url === '/api/gemini/trends') {
    const prompt =
      "Act as a publishing market analyst. Perform deep research to identify the current top 5 trending ebook topics/genres for the current week/month. For each trend, provide: 1. The Genre/Topic Name. 2. Why it is trending (viral events, seasonal, etc). 3. Estimated gross sales potential or popularity ranking if available. 4. Target audience. 5. A specific 'Book Idea' prompt for a user. Summarize the findings in markdown.";
    const res = await callOpenRouterDirectFromBrowser(prompt, payload.model);
    return {
      content: res.text || 'No trends found.',
      sources: [],
      model: res.model,
      usage: res.usage,
    };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const rawText = await response.text();
  let data: any;
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(
      `Server error (${response.status}): ${rawText.slice(0, 140).trim() || 'Invalid response from API endpoint'}`
    );
  }

  if (!response.ok) {
    throw new Error(data?.error || `Request failed with status ${response.status}`);
  }

  return data;
}

export interface TrendResult {
  content: string;
  sources: { title: string; uri: string }[];
}

export const researchBookTrends = async (): Promise<TrendResult> => {
  const model = PricingService.getSelectedTextModel();
  const data = await fetchApiJson('/api/gemini/trends', { model });

  if (data.usage) {
    PricingService.trackUsage(
      data.model || model,
      data.usage.promptTokenCount || 0,
      data.usage.candidatesTokenCount || 0
    );
  }

  return {
    content: data.content || 'No trends found.',
    sources: data.sources || [],
  };
};

export const transcribeAudio = async (base64Audio: string, mimeType: string): Promise<string> => {
  const model = PricingService.getSelectedTextModel();
  const data = await fetchApiJson('/api/gemini/transcribe', { base64Audio, mimeType, model });

  if (data.usage) {
    PricingService.trackUsage(
      data.model || model,
      data.usage.promptTokenCount || 0,
      data.usage.candidatesTokenCount || 0
    );
  }

  return data.text || '';
};

export const generateOutline = async (
  sources: Source[], 
  customInstruction?: string,
  options?: WritingOptions & { model?: string }
): Promise<BookOutline> => {
  const parts: any[] = [];
  const model = options?.model || PricingService.getSelectedTextModel();

  parts.push({ text: buildOutlinePrompt(customInstruction, options) });
  parts.push({ text: formatSources(sources) });
  if (sources.some(source => source.type === SourceType.IMAGE)) {
    parts.push({ text: 'Image attachments are visual references only; this text-only pipeline cannot read them. Do not infer factual evidence from unseen images.' });
  }

  const data = await fetchApiJson('/api/gemini/outline', { parts, model });

  if (data.usage) {
    PricingService.trackUsage(
      data.model || model,
      data.usage.promptTokenCount || 0,
      data.usage.candidatesTokenCount || 0
    );
  }

  const parsed = data.outline as BookOutline;
  if (parsed.loreVault || parsed.loreBible) {
    const vault = parsed.loreVault || parsed.loreBible;
    parsed.loreVault = vault;
    parsed.loreBible = vault;
  }
  return parsed;
};

export const generateImage = async (
  prompt: string,
  aspectRatio: "1:1" | "3:4" | "4:3" | "16:9" | "9:16" = "1:1",
  customModel?: string,
  purpose: 'template' | 'cover' | 'chapter' = 'template'
): Promise<string> => {
  if (purpose !== 'template') {
    // The instant cover engine is a template, not a chapter-aware AI illustrator.
    const model = customModel && customModel !== 'instant-editorial-svg' ? customModel : PricingService.getSelectedTextModel();
    const data = await fetchApiJson('/api/gemini/generate-text', { parts: [{ text: prompt }], model });
    if (data.usage) PricingService.trackUsage(data.model || model, data.usage.promptTokenCount || 0, data.usage.candidatesTokenCount || 0);
    const svg = prepareIllustrationSvg(data.text || '', purpose === 'cover' ? 600 : 800, purpose === 'cover' ? 800 : 450);
    const bytes = new TextEncoder().encode(svg);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `data:image/svg+xml;base64,${btoa(binary)}`;
  }
  const model = customModel || PricingService.getSelectedCoverModel();
  const data = await fetchApiJson('/api/gemini/image', { prompt, aspectRatio, model });
  if (!data.base64) {
    throw new Error(data.error || 'Failed to generate image.');
  }

  PricingService.trackUsage(
    data.model || model,
    data.usage?.promptTokenCount || 1,
    data.usage?.candidatesTokenCount || 0
  );
  return data.base64;
};

export interface ChapterWriteOptions extends WritingOptions {
  twoPassPolish?: boolean;
  model?: string;
}

export const writeChapter = async (
  chapter: ChapterOutline,
  outline: BookOutline,
  sources: Source[],
  options: ChapterWriteOptions = {}
): Promise<string> => {
  const { style = 'standard', pov = 'third_limited', tense = 'past', twoPassPolish = false } = options;
  const chapterLabel = chapter.chapterNumber === 0 ? 'Introduction' : `Chapter ${chapter.chapterNumber}`;
  const parts = [
    { text: buildChapterPrompt(chapter, outline, options) },
    { text: formatSources(sources) },
  ];

  const MAX_RETRIES = 6;
  let lastError: any;
  let draftContent = "";
  const activeModel = options.model || PricingService.getSelectedTextModel();

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // If phone temporarily lost network while locked/switching towers, wait briefly for connection
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await delay(3000);
      }

      const data = await fetchApiJson('/api/gemini/generate-text', { parts, model: activeModel });

      if (data.usage) {
        PricingService.trackUsage(
          data.model || activeModel,
          data.usage.promptTokenCount || 0,
          data.usage.candidatesTokenCount || 0
        );
      }

      draftContent = data.text || "";
      if (draftContent) break;
    } catch (error: any) {
      lastError = error;
      console.warn(`Chapter ${chapter.chapterNumber} attempt ${i + 1} failed:`, error.message);
      await delay(2000 * Math.min(i + 1, 3));
    }
  }

  if (!draftContent) {
    throw new Error(`Failed to write ${chapterLabel} after multiple attempts. Last error: ${lastError?.message}`);
  }

  // Optional Two-Pass Generation (disabled by default to conserve Free Tier RPM quota)
  if (twoPassPolish) {
    try {
      await delay(1200);
      const polished = await refineChapterText(
        draftContent,
        isNonfiction(style)
          ? 'Polish clarity, explanation, transitions, and restrained wit. Preserve all facts, dates, qualifications, source citations, and evidence gaps. Do not add scenes, dialogue, or unsupported claims.'
          : `Polish this chapter: remove clichés, strengthen active verbs, improve dialogue and pacing, and maintain events, length, POV (${pov}), and tense (${tense}).`,
        activeModel,
        { ...options, sources }
      );
      if (polished && polished.trim().length > 100) {
        return polished;
      }
    } catch (polishErr) {
      console.warn(`Pass 2 style refinement encountered an error, keeping draft:`, polishErr);
    }
  }

  return draftContent;
};

export const refineChapterText = async (
  currentContent: string,
  instruction: string,
  customModel?: string,
  options: WritingOptions & { sources?: Source[] } = {}
): Promise<string> => {
  const model = customModel || PricingService.getSelectedTextModel();
  const parts = [{ text: buildRefinementPrompt(currentContent, instruction, options) }];

  const data = await fetchApiJson('/api/gemini/generate-text', { parts, model });

  if (data.usage) {
    PricingService.trackUsage(
      data.model || model,
      data.usage.promptTokenCount || 0,
      data.usage.candidatesTokenCount || 0
    );
  }

  return data.text || currentContent;
};

export const generateSpeech = async (text: string, voiceName: string = 'Kore'): Promise<string> => {
  try {
    const response = await fetch('/api/gemini/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voiceName }),
    });

    const data = await response.json();
    if (!response.ok || !data.audioData) {
      return "";
    }

    PricingService.trackUsage(data.model || 'gemini-3.8-flash-lite-tts', text.length, 0);
    return data.audioData;
  } catch (error) {
    console.warn("TTS generation error:", error);
    return "";
  }
};
