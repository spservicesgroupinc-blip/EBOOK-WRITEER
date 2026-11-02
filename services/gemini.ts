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

// Helper for delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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

async function fetchApiJson(url: string, payload: Record<string, any>): Promise<any> {
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

  const MAX_RETRIES = 3;
  let lastError: any;
  let draftContent = "";
  const activeModel = options.model || PricingService.getSelectedTextModel();

  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
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
      await delay(2000 * (i + 1));
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
