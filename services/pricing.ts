
export interface UsageRecord {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  timestamp: number;
  type: 'text' | 'image' | 'audio' | 'search';
}

/** USD price per 1M tokens, matching how OpenRouter pricing is displayed. */
export interface ModelPricing {
  prompt: number;
  completion: number;
}

export interface ModelOption {
  id: string;
  name: string;
  description: string;
  modality?: string;
  isFree?: boolean;
  pricing?: ModelPricing;
}

/** @deprecated Use ModelOption. Kept so older imports keep compiling. */
export type FreeModelOption = ModelOption;

export interface CostSummary {
  totalCost: number;
  sessionCost: number;
  totalTokens: number;
  isFreeTier: boolean;
  lastModelUsed: string;
  selectedTextModel: string;
  selectedCoverModel: string;
}

export const DEFAULT_TEXT_MODEL = 'google/gemma-4-26b-a4b-it:free';
export const DEFAULT_COVER_MODEL = 'instant-editorial-svg';

export const FREE_PRICING: ModelPricing = { prompt: 0, completion: 0 };

/** Offline/fallback catalog of curated zero-cost models. */
export const CURATED_MODELS: ModelOption[] = [
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
].map((model) => ({ ...model, pricing: FREE_PRICING, isFree: true }));

export const COVER_ONLY_EXTRA_OPTIONS: ModelOption[] = [
  {
    id: 'instant-editorial-svg',
    name: 'Automatic (Uses Selected Writing Model)',
    description: 'Uses your selected writing model to create original SVG cover art and chapter illustrations',
    modality: 'svg',
  },
].map((model) => ({ ...model, pricing: FREE_PRICING, isFree: true }));

const STORAGE_KEY = 'ebookai_cost_history';
const TEXT_MODEL_KEY = 'ebookai_openrouter_text_model';
const COVER_MODEL_KEY = 'ebookai_openrouter_cover_model';

const normalizePricing = (pricing?: Partial<ModelPricing> | null): ModelPricing => {
  const prompt = Number(pricing?.prompt);
  const completion = Number(pricing?.completion);
  return {
    prompt: Number.isFinite(prompt) && prompt > 0 ? prompt : 0,
    completion: Number.isFinite(completion) && completion > 0 ? completion : 0,
  };
};

const withPricing = (model: ModelOption): ModelOption => {
  const pricing = normalizePricing(model.pricing);
  return {
    ...model,
    pricing,
    isFree: pricing.prompt === 0 && pricing.completion === 0,
  };
};

/** Free models first, then paid models, each ordered by display name. */
const sortModels = (models: ModelOption[]): ModelOption[] =>
  [...models].sort((a, b) => {
    if (Boolean(a.isFree) !== Boolean(b.isFree)) return a.isFree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

export const PricingService = {
  sessionCost: 0,
  lastModelUsed: DEFAULT_TEXT_MODEL,
  models: CURATED_MODELS.map(withPricing) as ModelOption[],
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

  getModels(): ModelOption[] {
    return this.models;
  },

  getCoverModels(): ModelOption[] {
    return [...this.models, ...COVER_ONLY_EXTRA_OPTIONS];
  },

  getModel(modelId: string): ModelOption | undefined {
    return this.models.find((model) => model.id === modelId);
  },

  getModelPricing(modelId: string): ModelPricing {
    return this.getModel(modelId)?.pricing || FREE_PRICING;
  },

  isModelFree(modelId: string): boolean {
    const model = this.getModel(modelId);
    if (model) return Boolean(model.isFree);
    return modelId === 'openrouter/free' || modelId.endsWith(':free');
  },

  async refreshLiveModels(): Promise<ModelOption[]> {
    try {
      const res = await fetch('/api/openrouter/models');
      if (!res.ok) return this.models;
      const data = await res.json();
      if (Array.isArray(data.models) && data.models.length > 0) {
        const merged = new Map<string, ModelOption>();
        // Seed with curated entries so offline-friendly names/descriptions survive.
        for (const item of CURATED_MODELS) {
          merged.set(item.id, withPricing(item));
        }
        for (const live of data.models) {
          if (!live?.id) continue;
          const existing = merged.get(live.id);
          merged.set(
            live.id,
            withPricing({
              id: String(live.id),
              name: live.name || existing?.name || String(live.id),
              description: live.description || existing?.description || 'OpenRouter model',
              modality: live.modality || existing?.modality || 'text->text',
              pricing: live.pricing || existing?.pricing,
            })
          );
        }
        this.models = sortModels(Array.from(merged.values()));
        this.notifyCurrent();
      }
    } catch {
      // Keep curated list if offline
    }
    return this.models;
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
    const resolved = model || this.getSelectedTextModel();
    // OpenRouter may echo a canonical id; fall back to the selected model's pricing.
    const pricing =
      this.getModel(resolved)?.pricing ||
      this.getModel(this.getSelectedTextModel())?.pricing ||
      FREE_PRICING;
    const cost =
      (Math.max(0, inputCount) / 1_000_000) * pricing.prompt +
      (Math.max(0, outputCount) / 1_000_000) * pricing.completion;

    this.lastModelUsed = resolved;
    this.sessionCost += cost;
    this.updateStorage(cost, inputCount + outputCount);

    this.notifyCurrent();
  },

  currentSummary(): CostSummary {
    const history = this.getHistory();
    const selectedTextModel = this.getSelectedTextModel();
    return {
      sessionCost: this.sessionCost,
      totalCost: history.totalCost,
      totalTokens: history.totalTokens,
      isFreeTier: this.isModelFree(selectedTextModel),
      lastModelUsed: this.lastModelUsed,
      selectedTextModel,
      selectedCoverModel: this.getSelectedCoverModel(),
    };
  },

  notifyCurrent() {
    this.notify(this.currentSummary());
  },

  subscribe(callback: (summary: CostSummary) => void) {
    this.listeners.add(callback);
    callback(this.currentSummary());
    return () => this.listeners.delete(callback);
  },

  notify(summary: CostSummary) {
    this.listeners.forEach(cb => cb(summary));
  }
};
