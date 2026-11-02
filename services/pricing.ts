
export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
  type: 'text' | 'image' | 'audio' | 'search';
}

export interface FreeModelOption {
  id: string;
  name: string;
  description: string;
  modality?: string;
}

export interface CostSummary {
  totalCost: number;
  sessionCost: number;
  totalTokens: number;
  isFreeTier: boolean;
  lastModelUsed: string;
  selectedTextModel: string;
  selectedCoverModel: string;
}

export const DEFAULT_TEXT_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';
export const DEFAULT_COVER_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

export const DEFAULT_FREE_MODELS: FreeModelOption[] = [
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'NVIDIA: Nemotron 3 Ultra 550B (Free)',
    description: 'Flagship 550B reasoning & bestseller prose model',
    modality: 'text->text',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    name: 'Google: Gemma 4 31B Instruct (Free)',
    description: 'Rich literary prose, outlining & detailed SVG vector art',
    modality: 'text+image+video->text',
  },
  {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Google: Gemma 4 26B A4B MoE (Free)',
    description: 'Fast, expressive instruction-tuned multimodal model',
    modality: 'text+image+video->text',
  },
  {
    id: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'NVIDIA: Nemotron 3.5 Super VL (Free)',
    description: 'Vision-language specialist great for visual cover layout & scenes',
    modality: 'text+image+video->text',
  },
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    name: 'NVIDIA: Nemotron 3.5 Lightning (Free)',
    description: 'Ultra-fast, low-latency generation for rapid drafting',
    modality: 'text->text',
  },
  {
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',
    name: 'NVIDIA: Nemotron 3 Nano Omni 30B (Free)',
    description: 'Compact reasoning & multimodal model',
    modality: 'text+image+audio+video->text',
  },
  {
    id: 'thinkingmachines/inkling:free',
    name: 'Thinking Machines: Inkling (Free)',
    description: 'Creative storytelling & nuanced voice',
    modality: 'text+image+audio->text',
  },
  {
    id: 'thinkingmachines/inkling-small:free',
    name: 'Thinking Machines: Inkling Small (Free)',
    description: 'Fast creative model for quick chapters & edits',
    modality: 'text+image+audio->text',
  },
  {
    id: 'recursive/flint-v1.0:free',
    name: 'Recursive: Flint v1.0 (Free)',
    description: 'Crisp structural outlining & clean narrative flow',
    modality: 'text->text',
  },
  {
    id: 'xingchen-agi/xing4.0-29b-a4b:free',
    name: 'XingChen: Xing 4.0 29B A4B (Free)',
    description: 'Balanced MoE model for general writing & structure',
    modality: 'text->text',
  },
  {
    id: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots Studio: Dots3-Note Preview (Free)',
    description: 'Specialized in synthesizing source notes into outlines',
    modality: 'text+image->text',
  },
  {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere: North Mini Code (Free)',
    description: 'Precision structured JSON & intricate SVG vector cover code',
    modality: 'text->text',
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    name: 'LiquidAI: LFM 2.5 2.6B (Free)',
    description: 'Lightweight liquid foundation model',
    modality: 'text->text',
  },
  {
    id: 'openrouter/free',
    name: 'OpenRouter: Auto Free Router (openrouter/free)',
    description: 'Automatically routes to the fastest available free model',
    modality: 'text+image->text',
  },
];

export const COVER_ONLY_EXTRA_OPTIONS: FreeModelOption[] = [
  {
    id: 'instant-editorial-svg',
    name: 'Instant Editorial Vector Engine (Zero-Wait SVG)',
    description: 'Deterministic minimalist print cover & charcoal sketch generator',
    modality: 'svg',
  },
];

const STORAGE_KEY = 'ebookai_cost_history';
const TEXT_MODEL_KEY = 'ebookai_openrouter_text_model';
const COVER_MODEL_KEY = 'ebookai_openrouter_cover_model';

export const PricingService = {
  sessionCost: 0,
  isFreeTier: true,
  lastModelUsed: DEFAULT_TEXT_MODEL,
  freeModels: [...DEFAULT_FREE_MODELS] as FreeModelOption[],
  listeners: new Set<(summary: CostSummary) => void>(),

  getSelectedTextModel(): string {
    try {
      return localStorage.getItem(TEXT_MODEL_KEY) || DEFAULT_TEXT_MODEL;
    } catch {
      return DEFAULT_TEXT_MODEL;
    }
  },

  setSelectedTextModel(modelId: string) {
    try {
      localStorage.setItem(TEXT_MODEL_KEY, modelId);
    } catch {
      // ignore storage errors
    }
    this.notifyCurrent();
  },

  getSelectedCoverModel(): string {
    try {
      return localStorage.getItem(COVER_MODEL_KEY) || DEFAULT_COVER_MODEL;
    } catch {
      return DEFAULT_COVER_MODEL;
    }
  },

  setSelectedCoverModel(modelId: string) {
    try {
      localStorage.setItem(COVER_MODEL_KEY, modelId);
    } catch {
      // ignore storage errors
    }
    this.notifyCurrent();
  },

  getFreeModels(): FreeModelOption[] {
    return this.freeModels;
  },

  getCoverModels(): FreeModelOption[] {
    return [...this.freeModels, ...COVER_ONLY_EXTRA_OPTIONS];
  },

  async refreshLiveFreeModels(): Promise<FreeModelOption[]> {
    try {
      const res = await fetch('/api/openrouter/models');
      if (!res.ok) return this.freeModels;
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        const mergedMap = new Map<string, FreeModelOption>();
        // Keep curated descriptions first
        for (const item of DEFAULT_FREE_MODELS) {
          mergedMap.set(item.id, item);
        }
        for (const live of data.models) {
          if (!mergedMap.has(live.id)) {
            mergedMap.set(live.id, {
              id: live.id,
              name: live.name || live.id,
              description: live.description || 'Live OpenRouter free model',
              modality: live.modality || 'text->text',
            });
          }
        }
        this.freeModels = Array.from(mergedMap.values());
        this.notifyCurrent();
      }
    } catch {
      // Keep default curated list if offline
    }
    return this.freeModels;
  },

  getHistory(): { totalCost: number; totalTokens: number } {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : { totalCost: 0, totalTokens: 0 };
    } catch {
      return { totalCost: 0, totalTokens: 0 };
    }
  },

  updateStorage(cost: number, tokens: number) {
    const history = this.getHistory();
    history.totalCost += cost;
    history.totalTokens += tokens;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    return history;
  },

  trackUsage(model: string, inputCount: number, outputCount: number) {
    const cost = 0; // All OpenRouter :free models are $0.00
    this.lastModelUsed = model || this.getSelectedTextModel();
    this.sessionCost += cost;
    const history = this.updateStorage(cost, inputCount + outputCount);

    this.notify({
      sessionCost: this.sessionCost,
      totalCost: history.totalCost,
      totalTokens: history.totalTokens,
      isFreeTier: this.isFreeTier,
      lastModelUsed: this.lastModelUsed,
      selectedTextModel: this.getSelectedTextModel(),
      selectedCoverModel: this.getSelectedCoverModel(),
    });
  },

  notifyCurrent() {
    const history = this.getHistory();
    this.notify({
      sessionCost: this.sessionCost,
      totalCost: history.totalCost,
      totalTokens: history.totalTokens,
      isFreeTier: this.isFreeTier,
      lastModelUsed: this.lastModelUsed,
      selectedTextModel: this.getSelectedTextModel(),
      selectedCoverModel: this.getSelectedCoverModel(),
    });
  },

  subscribe(callback: (summary: CostSummary) => void) {
    this.listeners.add(callback);
    const history = this.getHistory();
    callback({
      sessionCost: this.sessionCost,
      totalCost: history.totalCost,
      totalTokens: history.totalTokens,
      isFreeTier: this.isFreeTier,
      lastModelUsed: this.lastModelUsed,
      selectedTextModel: this.getSelectedTextModel(),
      selectedCoverModel: this.getSelectedCoverModel(),
    });
    return () => this.listeners.delete(callback);
  },

  notify(summary: CostSummary) {
    this.listeners.forEach(cb => cb(summary));
  }
};
