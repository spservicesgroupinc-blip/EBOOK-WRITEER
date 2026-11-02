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
import { PricingService } from "./pricing";
import { BackgroundKeeper } from "./backgroundKeeper";

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
  try {
    const res = await fetch('/api/client-config');
    if (res.ok) {
      const data = await res.json();
      if (data?.apiKey) {
        cachedApiKey = String(data.apiKey).trim();
        return cachedApiKey;
      }
    }
  } catch {
    // Ignore and fall back
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
  const loreVault: LoreVault = {
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
          provider: { sort: 'throughput' },
          reasoning: { effort: 'low', exclude: true },
          stream: false,
        }),
      });

      const data = await response.json();
      if (!response.ok || data?.error) {
        throw new Error(data?.error?.message || `OpenRouter HTTP ${response.status}`);
      }

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
  options?: { pov?: ManuscriptPov; tense?: ManuscriptTense; targetDepth?: TargetDepth; model?: string }
): Promise<BookOutline> => {
  const parts: any[] = [];
  const model = options?.model || PricingService.getSelectedTextModel();

  // 1. System Instruction / Goal
  let systemText = `You are a world-class literary editor and master storyteller. Analyze the provided source materials to build a comprehensive book outline and a rich Story & Lore Vault.
    
    The source material may include text notes, audio transcripts, and visual references (images).
    Find the narrative arc, core themes, key events, character dynamics, and world/technical details.
    
    STRUCTURE REQUIREMENTS:
    1. Introduction: Include a distinct "Introduction" chapter first (assign it chapterNumber: 0). Setting the stage, tone, and hook without summarizing the entire ending.
    2. Chapter 1: Begin the main narrative or core subject content.
    3. Subsequent Chapters: Develop the story or non-fiction ideas logically step-by-step with clear chapter goals.
    
    LORE VAULT REQUIREMENTS:
    - Extract key characters with their roles and distinct traits/profiles.
    - Extract world/setting details or core foundational principles.
    - Extract key terminology, jargon, or recurring concepts.
    - Summarize overarching plot arcs or structural rules.`;

  if (options) {
    if (options.pov) systemText += `\nTarget Point of View: ${options.pov}`;
    if (options.tense) systemText += `\nTarget Tense: ${options.tense}`;
    if (options.targetDepth) systemText += `\nTarget Chapter Depth: ${options.targetDepth}`;
  }

  if (customInstruction && customInstruction.trim()) {
    systemText += `\n\nIMPORTANT SPECIAL INSTRUCTIONS:\nThe user provided specific guidance: "${customInstruction}". Prioritize this guidance when structuring the outline.`;
  }

  parts.push({ text: systemText });

  // 2. Add Sources
  for (const source of sources) {
    if (source.type === SourceType.TEXT) {
      parts.push({ text: `\n\n--- Source: ${source.name} (Notes) ---\n${source.content}` });
    } else if (source.type === SourceType.AUDIO && source.transcription) {
      parts.push({ text: `\n\n--- Source: ${source.name} (Transcript) ---\n${source.transcription}` });
    } else if (source.type === SourceType.IMAGE) {
      parts.push({ text: `\n\n--- Source: ${source.name} (Visual Reference) ---` });
      parts.push({
        inlineData: {
          data: source.content,
          mimeType: source.mimeType || 'image/jpeg',
        },
      });
    }
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
  customModel?: string
): Promise<string> => {
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

export interface ChapterWriteOptions {
  style?: WritingStyle;
  pov?: ManuscriptPov;
  tense?: ManuscriptTense;
  targetDepth?: TargetDepth;
  twoPassPolish?: boolean;
  previousChapterEnding?: string;
  nextChapterSummary?: string;
  storySoFarRecap?: string;
  loreVault?: LoreVault;
  loreBible?: LoreVault;
  model?: string;
}

export const writeChapter = async (
  chapter: ChapterOutline,
  outline: BookOutline,
  sources: Source[],
  options: ChapterWriteOptions = {}
): Promise<string> => {
  const {
    style = 'standard',
    pov = 'third_limited',
    tense = 'past',
    targetDepth = 'standard',
    twoPassPolish = false,
    previousChapterEnding,
    nextChapterSummary,
    storySoFarRecap,
    loreVault = options.loreVault || options.loreBible || outline.loreVault || outline.loreBible,
  } = options;

  const parts: any[] = [];
  const isIntro = chapter.chapterNumber === 0;
  const chapterLabel = isIntro ? "Introduction" : `Chapter ${chapter.chapterNumber}`;

  const depthWordTargets: Record<TargetDepth, string> = {
    short: "Aim for approximately 1,200 to 1,500 words. Keep scenes punchy and fast-moving.",
    standard: "Aim for approximately 2,200 to 2,800 words. Develop deep scenes, rich dialogue, and sensory atmosphere.",
    epic: "Aim for an expansive 3,200 to 4,000 words. Fully flesh out every detail, character monologue, subtle subtext, and scene nuance.",
  };

  const povInstructions: Record<ManuscriptPov, string> = {
    first: "Write strictly in FIRST-PERSON ('I', 'me', 'my', 'we'). Provide deep internal thoughts and immediate subjective perspective.",
    third_limited: "Write strictly in THIRD-PERSON LIMITED ('he', 'she', 'they'). Focus closely on the main character's experience without switching perspectives mid-scene.",
    second: "Write strictly in SECOND-PERSON ('you', 'your'). Directly engage the reader in an immersive, immediate manner.",
    omniscient: "Write in THIRD-PERSON OMNISCIENT ('he', 'she', 'they'). Provide wide narrative perspective and insight into multiple characters/elements.",
  };

  const tenseInstructions: Record<ManuscriptTense, string> = {
    past: "Write strictly in PAST TENSE ('walked', 'said', 'realized'). Maintain total grammatical consistency.",
    present: "Write strictly in PRESENT TENSE ('walks', 'says', 'realizes'). Create urgent, immediate narrative flow.",
  };

  const styleInstructions: Record<WritingStyle, string> = {
    standard: 'Write in a clear, engaging, and professional bestseller style.',
    literary: 'Use rich sensory descriptions, evocative metaphors, and elevated prose.',
    humorous: 'Be witty, light-hearted, clever, and entertaining.',
    technical: 'Be precise, factual, educational, and structured.',
    simple: 'Use direct sentence structures and accessible vocabulary for seamless readability.',
    sarcastic: 'Write in a highly sarcastic, witty manner with sharp humor and a cynical tone.',
  };

  const openingHookStrategies = [
    "OPENING HOOK STRATEGY (Immediate Action / Scene Beat): Open directly inside a concrete physical action, unfolding moment, or decisive event—never with generic weather or throat-clearing.",
    "OPENING HOOK STRATEGY (Incisive Voice / Dialogue): Open with a striking spoken line, sharp observation, or immediate human tension that pulls the reader straight into the scene.",
    "OPENING HOOK STRATEGY (Sensory & Atmospheric Contrast): Open with a vivid, unexpected sensory detail or contrast in the environment that anchors the mood and stakes immediately.",
    "OPENING HOOK STRATEGY (Internal Realization / Provocative Hook): Open with an urgent realization, high-stakes dilemma, or compelling thesis that bridges directly from the previous chapter's aftermath.",
  ];
  const openingStrategy = openingHookStrategies[Math.abs(chapter.chapterNumber) % openingHookStrategies.length];

  let systemPrompt = `You are an award-winning bestseller author. Write the complete manuscript content for ${chapterLabel}: "${chapter.title}".

BOOK CONTEXT:
- Title: ${outline.title}
- Synopsis: ${outline.description}
- Chapter Goal & Summary: ${chapter.summary}

MANUSCRIPT STYLE & FORMATTING DIRECTIVES:
- Word Count Target: ${depthWordTargets[targetDepth]}
- Point of View: ${povInstructions[pov]}
- Tense: ${tenseInstructions[tense]}
- Literary Style: ${styleInstructions[style]}
- ${openingStrategy}`;

  if (loreVault) {
    systemPrompt += `\n\nSTORY & LORE VAULT CONTEXT:`;
    if (loreVault.characters && loreVault.characters.length > 0) {
      systemPrompt += `\n- Key Characters: ${loreVault.characters.map(c => `${c.name} (${c.role}): ${c.description}`).join('; ')}`;
    }
    if (loreVault.worldAndSetting) {
      systemPrompt += `\n- Setting & World Rules: ${loreVault.worldAndSetting}`;
    }
    if (loreVault.keyTermsAndConcepts && loreVault.keyTermsAndConcepts.length > 0) {
      systemPrompt += `\n- Terminology & Concepts: ${loreVault.keyTermsAndConcepts.join(', ')}`;
    }
  }

  if (storySoFarRecap && storySoFarRecap.trim()) {
    systemPrompt += `\n\nSTORY SO FAR (Recap of preceding chapters):
${storySoFarRecap.trim()}`;
  }

  if (previousChapterEnding && previousChapterEnding.trim()) {
    systemPrompt += `\n\nPREVIOUS CHAPTER ENDING SCENE:
"${previousChapterEnding.trim()}"
CRITICAL CONTINUITY REQUIREMENT: Do NOT re-introduce characters, re-explain core premises, or restart the timeline. Begin this chapter seamlessly picking up momentum, emotional resonance, or thematic thread from the previous ending.`;
  }

  if (nextChapterSummary && nextChapterSummary.trim()) {
    systemPrompt += `\n\nUPCOMING NEXT CHAPTER (Foreshadowing & Bridge Target):
${nextChapterSummary.trim()}
CLOSING BRIDGE REQUIREMENT: End this chapter on a resonant narrative beat, unresolved tension, or forward-looking transition that flows naturally into the upcoming chapter without prematurely resolving its events.`;
  }

  systemPrompt += `\n\nCHAPTER SCENE STRUCTURE & CADENCE:
1. Beat 1 (Seamless Entry & Grounding): Enter the scene smoothly from the preceding chapter's momentum, establishing immediate atmosphere and stakes.
2. Beat 2 (Escalation & Core Development): Unfold key character interactions, natural dialogue with subtext, or deep thematic/evidentiary progression.
3. Beat 3 (Resonant Climax & Forward Bridge): Bring this chapter's immediate arc to a compelling turn and hand off cleanly to the next chapter.

PROSE QUALITY & ANTI-SUMMARY DIRECTIVES ("SHOW, DON'T TELL"):
- Vary sentence length deliberately: pair crisp, punchy sentences during high-tension moments with longer, rhythmic sentences during reflection.
- Write in fully dramatized, immersive scenes. NEVER summarize plot jumps or use meta-phrases like 'In conclusion', 'As time passed', 'In this chapter', or 'Overall'.
- BAN AI CLICHÉS: Strictly avoid cliché phrases such as 'a testament to', 'in a world where', 'little did they know', 'a tapestry of', 'beacon of', 'let out a breath they didn't know they were holding', or 'delve'. Format using clean Markdown paragraphs.`;

  parts.push({ text: systemPrompt });

  for (const source of sources) {
    if (source.type === SourceType.TEXT) {
      parts.push({ text: `\n[Source: ${source.name}]: ${source.content.slice(0, 5000)}` });
    } else if (source.type === SourceType.AUDIO && source.transcription) {
      parts.push({ text: `\n[Source: ${source.name}]: ${source.transcription.slice(0, 5000)}` });
    } else if (source.type === SourceType.IMAGE) {
      parts.push({ text: `\n[Source: ${source.name} (Image Reference)]` });
      parts.push({
        inlineData: {
          data: source.content,
          mimeType: source.mimeType || 'image/jpeg',
        },
      });
    }
  }

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
        `Perform a master literary polish pass on this chapter. 
         1. Eliminate any remaining AI clichés ('testament to', 'tapestry', 'little did they know', 'beacon', 'delve', 'realm').
         2. Convert passive constructions to active, vivid verbs.
         3. Strengthen character dialogue cadence and sensory atmosphere.
         4. Maintain exact story events, length, POV (${pov}), and tense (${tense}).`,
        activeModel
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
  customModel?: string
): Promise<string> => {
  const model = customModel || PricingService.getSelectedTextModel();
  let detailedInstruction = instruction;
  if (instruction.includes('sensory') || instruction.includes('Deepen Sensory')) {
    detailedInstruction = "Enhance the text with vivid sensory details (sights, sounds, textures, scents, and physical atmosphere). Show, don't tell, without adding redundant filler.";
  } else if (instruction.includes('dialogue') || instruction.includes('Enrich Dialogue')) {
    detailedInstruction = "Expand and refine character dialogue with realistic subtext, distinct vocal tones, natural pauses, and physical action beats.";
  } else if (instruction.includes('pacing') || instruction.includes('Accelerate Pacing')) {
    detailedInstruction = "Heighten tension, tighten sentence structure, remove slow exposition, and increase narrative momentum.";
  } else if (instruction.includes('cliché') || instruction.includes('Strip AI Clichés')) {
    detailedInstruction = "Eliminate AI clichés ('testament to', 'in a world where', 'little did they know', 'tapestry', 'delve', 'beacon'), convert passive voice to active verbs, and sharpen vocabulary.";
  }

  const parts = [
    {
      text: `You are an expert bestseller book editor.
            
EDITING TASK: ${detailedInstruction}
            
CURRENT TEXT:
${currentContent}
            
Return ONLY the rewritten manuscript text in clean Markdown format. Do NOT add conversational intro/outro filler.`,
    },
  ];

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
