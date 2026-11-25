
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
  /** Shortlisted by OpenRouter's most-popular ordering for its role. */
  recommended?: boolean;
  popularityRank?: number;
  /** Model returns an image, so it must run through the Images API. */
  imageOutput?: boolean;
  /** Dynamic router (pricing reported as -1); cost is unknown until it runs. */
  isRouter?: boolean;
  /** USD cost per generated image, when OpenRouter publishes it. */
  pricePerImage?: number;
}

/** The two model roles this app needs: writing books and rendering artwork. */
export type ModelRole = 'writing' | 'image';

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
/** Offline template artwork engine, used only when no paid image model is selected. */
export const TEMPLATE_COVER_MODEL = 'instant-editorial-svg';
/** @deprecated Use TEMPLATE_COVER_MODEL. */
export const DEFAULT_COVER_MODEL = TEMPLATE_COVER_MODEL;

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
].map((model, index) => ({
  ...model,
  pricing: FREE_PRICING,
  isFree: true,
  imageOutput: false,
  recommended: index < 5,
  popularityRank: index,
}));

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
  const zeroTokenPrice = pricing.prompt === 0 && pricing.completion === 0;
  return {
    ...model,
    pricing,
    // Image models are priced per image, so zero token prices do not make them free.
    isFree: model.isFree === false ? false : zeroTokenPrice && !model.isRouter,
  };
};

/** Recommended first (OpenRouter popularity order), then free, then paid by name. */
const sortModels = (models: ModelOption[]): ModelOption[] =>
  [...models].sort((a, b) => {
    if (Boolean(a.recommended) !== Boolean(b.recommended)) return a.recommended ? -1 : 1;
    if (a.recommended && b.recommended) return (a.popularityRank || 0) - (b.popularityRank || 0);
    if (Boolean(a.isFree) !== Boolean(b.isFree)) return a.isFree ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

export const PricingService = {
  sessionCost: 0,
  lastModelUsed: DEFAULT_TEXT_MODEL,
  models: CURATED_MODELS.map(withPricing) as ModelOption[],
  imageModels: [] as ModelOption[],
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
      return localStorage.getItem(COVER_MODEL_KEY) || '';
    } catch {
      return '';
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

  hasStoredTextModel(): boolean {
    try {
      return Boolean(localStorage.getItem(TEXT_MODEL_KEY));
    } catch {
      return false;
    }
  },

  getModels(): ModelOption[] {
    return this.models;
  },

  getImageModels(): ModelOption[] {
    return this.imageModels;
  },

  /** The shortlist shown before the user opts into the full catalog. */
  getRecommendedModels(role: ModelRole = 'writing'): ModelOption[] {
    return this.getAllModels(role).filter((model) => model.recommended);
  },

  getAllModels(role: ModelRole = 'writing'): ModelOption[] {
    return role === 'image' ? this.imageModels : this.models;
  },

  /** True when the selection must run through OpenRouter's Images API. */
  isImageModel(modelId: string): boolean {
    if (!modelId || modelId === TEMPLATE_COVER_MODEL) return false;
    return this.imageModels.some((model) => model.id === modelId);
  },

  getModel(modelId: string): ModelOption | undefined {
    return this.models.find((model) => model.id === modelId) || this.imageModels.find((model) => model.id === modelId);
  },

  getModelPricing(modelId: string): ModelPricing {
    return this.getModel(modelId)?.pricing || FREE_PRICING;
  },

  isModelFree(modelId: string): boolean {
    const model = this.getModel(modelId);
    if (model) return Boolean(model.isFree);
    return modelId === 'openrouter/free' || modelId.endsWith(':free');
  },

  async fetchCatalog(role: ModelRole): Promise<ModelOption[]> {
    try {
      const res = await fetch(`/api/openrouter/models?for=${role}`);
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data.models)) return [];
      return data.models
        .filter((live: any) => Boolean(live?.id))
        .map((live: any) =>
          withPricing({
            id: String(live.id),
            name: String(live.name || live.id),
            description: String(live.description || ''),
            modality: String(live.modality || (role === 'image' ? 'text->image' : 'text->text')),
            pricing: live.pricing,
            recommended: Boolean(live.recommended),
            popularityRank: Number(live.popularityRank) || 0,
            imageOutput: Boolean(live.imageOutput) || role === 'image',
            isRouter: Boolean(live.isRouter),
            pricePerImage: Number(live.pricePerImage) > 0 ? Number(live.pricePerImage) : undefined,
            isFree: Boolean(live.isFree),
          })
        );
    } catch {
      return [];
    }
  },

  async refreshLiveModels(): Promise<ModelOption[]> {
    const [writing, images] = await Promise.all([this.fetchCatalog('writing'), this.fetchCatalog('image')]);

    if (writing.length > 0) {
      const merged = new Map<string, ModelOption>();
      // Seed with curated entries so offline-friendly names/descriptions survive.
      // Live rankings own the shortlist, so curated entries stay in the full catalog only.
      for (const item of CURATED_MODELS) {
        merged.set(item.id, withPricing({ ...item, recommended: false }));
      }
      for (const live of writing) {
        const existing = merged.get(live.id);
        merged.set(live.id, {
          ...live,
          name: live.name || existing?.name || live.id,
          description: live.description || existing?.description || 'OpenRouter model',
        });
      }
      this.models = sortModels(Array.from(merged.values()));
    }

    if (images.length > 0) {
      this.imageModels = sortModels(images);
    }

    this.notifyCurrent();
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

  /** Image models are billed per image, so record OpenRouter's reported cost directly. */
  trackImageUsage(model: string, costUsd: number) {
    const cost = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
    this.lastModelUsed = model;
    this.sessionCost += cost;
    this.updateStorage(cost, 0);

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
