

export enum SourceType {
  AUDIO = 'AUDIO',
  TEXT = 'TEXT',
  IMAGE = 'IMAGE'
}

export interface Source {
  id: string;
  type: SourceType;
  content: string; // Text content or Base64 audio/image string
  mimeType?: string; // For audio/image
  name: string;
  transcription?: string; // If audio, the transcribed text
  isProcessing: boolean;
  research?: { url: string; retrievedAt: string; revisionDate?: string; query?: string };
}

export interface ChapterOutline {
  chapterNumber: number;
  title: string;
  summary: string;
}

export type WritingStyle = 'standard' | 'literary' | 'humorous' | 'technical' | 'simple' | 'sarcastic' | 'educational_nonfiction';

export type ManuscriptPov = 'first' | 'third_limited' | 'second' | 'omniscient';
export type ManuscriptTense = 'past' | 'present';
export type TargetDepth = 'short' | 'standard' | 'epic';

export interface CharacterProfile {
  name: string;
  role: string;
  description: string;
}

export interface LoreVault {
  characters: CharacterProfile[];
  worldAndSetting: string;
  keyTermsAndConcepts: string[];
  plotArcsAndRules: string;
}

// Deprecated alias for backwards compatibility
export type LoreBible = LoreVault;

export interface BookOutline {
  title: string;
  description: string;
  chapters: ChapterOutline[];
  coverImage?: string;
  backCoverImage?: string;
  loreVault?: LoreVault;
  loreBible?: LoreVault;
}

export interface ChapterContent {
  illustrationPrompt?: string;
  chapterNumber: number;
  title: string;
  content: string;
  isGenerating: boolean;
  image?: string; // Base64 string for chapter sketch/illustration
}

export interface ProjectSettings {
  coverArtPrompt?: string;
  writingStyle?: WritingStyle;
  automaticResearch?: boolean;
  researchTopic?: string;
  pov?: ManuscriptPov;
  tense?: ManuscriptTense;
  targetDepth?: TargetDepth;
  twoPassPolish?: boolean;
  textModel?: string;
  coverModel?: string;
}

export interface BookProject {
  id: string;
  title: string;
  lastModified: number;
  sources: Source[];
  outline: BookOutline | null;
  chapters: ChapterContent[];
  currentStep: number; // 0: Sources, 1: Outline, 2: Writing, 3: Read
  seriesId?: string;
  seriesIndex?: number;
  audioVoice?: string; // Preferred voice for TTS
  customInstruction?: string; // User-defined prompt instructions
  pov?: ManuscriptPov;
  tense?: ManuscriptTense;
  targetDepth?: TargetDepth;
  twoPassPolish?: boolean;
  settings?: ProjectSettings;
  loreVault?: LoreVault;
  loreBible?: LoreVault;
}

export interface User {
  username: string;
  folderId: string;
  backendUrl: string; // The Google Apps Script URL
}

export enum AppView {
  AUTH = 'AUTH',
  DASHBOARD = 'DASHBOARD',
  EDITOR = 'EDITOR'
}
