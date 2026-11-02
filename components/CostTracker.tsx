
import React, { useEffect, useState } from 'react';
import { CheckCircle2, Cpu, Palette, RefreshCw, ChevronUp, X } from 'lucide-react';
import { PricingService, CostSummary, FreeModelOption, DEFAULT_TEXT_MODEL, DEFAULT_COVER_MODEL } from '../services/pricing';

export const CostTracker: React.FC = () => {
  const [costs, setCosts] = useState<CostSummary>({
    sessionCost: 0,
    totalCost: 0,
    totalTokens: 0,
    isFreeTier: true,
    lastModelUsed: DEFAULT_TEXT_MODEL,
    selectedTextModel: PricingService.getSelectedTextModel(),
    selectedCoverModel: PricingService.getSelectedCoverModel(),
  });
  const [isOpen, setIsOpen] = useState(false);
  const [textModels, setTextModels] = useState<FreeModelOption[]>(PricingService.getFreeModels());
  const [coverModels, setCoverModels] = useState<FreeModelOption[]>(PricingService.getCoverModels());
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const unsubscribe = PricingService.subscribe((summary) => {
      setCosts({ ...summary });
      setTextModels([...PricingService.getFreeModels()]);
      setCoverModels([...PricingService.getCoverModels()]);
    });

    // Fetch live free models from OpenRouter on mount
    PricingService.refreshLiveFreeModels().then(() => {
      setTextModels([...PricingService.getFreeModels()]);
      setCoverModels([...PricingService.getCoverModels()]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  const handleRefreshModels = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRefreshing(true);
    await PricingService.refreshLiveFreeModels();
    setTextModels([...PricingService.getFreeModels()]);
    setCoverModels([...PricingService.getCoverModels()]);
    setIsRefreshing(false);
  };

  const formatTokens = (num: number) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  const shortModelLabel = (modelId: string) => {
    if (!modelId) return 'Nemotron 3 Ultra';
    if (modelId === 'instant-editorial-svg') return 'Instant Vector';
    const parts = modelId.replace(':free', '').split('/');
    return parts[parts.length - 1];
  };

  return (
    <div className="fixed bottom-20 md:bottom-4 left-3 md:left-4 z-40 print:hidden no-print">
      {isOpen && (
        <div className="mb-2 w-[calc(100vw-1.5rem)] max-w-sm sm:w-96 bg-white border border-slate-200 shadow-2xl rounded-2xl p-4 text-xs text-slate-700 animate-in fade-in slide-in-from-bottom-2">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5 mb-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={15} className="text-emerald-500" />
              <span className="font-bold text-slate-900 text-sm">OpenRouter Free Models</span>
              <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                {textModels.length} Free
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={handleRefreshModels}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="Refresh live free models from OpenRouter"
              >
                <RefreshCw size={14} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                <Cpu size={12} className="text-blue-600" />
                Writing &amp; Outline AI Model (Free)
              </label>
              <select
                value={costs.selectedTextModel}
                onChange={(e) => PricingService.setSelectedTextModel(e.target.value)}
                className="w-full min-h-[44px] bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500"
              >
                {textModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1 truncate">
                {textModels.find((m) => m.id === costs.selectedTextModel)?.description || costs.selectedTextModel}
              </p>
            </div>

            <div>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                <Palette size={12} className="text-purple-600" />
                Cover Art &amp; Illustration AI Model (Free)
              </label>
              <select
                value={costs.selectedCoverModel}
                onChange={(e) => PricingService.setSelectedCoverModel(e.target.value)}
                className="w-full min-h-[44px] bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2 text-xs font-medium outline-none focus:ring-2 focus:ring-purple-500"
              >
                {coverModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1 truncate">
                {coverModels.find((m) => m.id === costs.selectedCoverModel)?.description || costs.selectedCoverModel}
              </p>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-mono">
              <span>Session Tokens: {formatTokens(costs.totalTokens)}</span>
              <span className="text-emerald-700 font-sans font-bold">$0.00 Free Tier</span>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="min-h-[40px] bg-white/95 backdrop-blur-md border border-emerald-200 shadow-lg rounded-full px-3.5 py-2 flex items-center gap-2 text-xs font-sans text-slate-700 hover:border-emerald-400 transition-colors cursor-pointer group"
        onClick={() => setIsOpen(!isOpen)}
        title="Click to choose your Free OpenRouter AI Models"
      >
        <div className="flex items-center gap-1.5 text-emerald-700 font-semibold">
          <CheckCircle2 size={14} className="text-emerald-500 shrink-0" />
          <span className="max-w-[110px] sm:max-w-none truncate">{shortModelLabel(costs.selectedTextModel)}</span>
        </div>

        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider shrink-0">
          Free
        </span>

        <ChevronUp
          size={13}
          className={`text-slate-400 transition-transform shrink-0 ${isOpen ? 'rotate-180 text-emerald-600' : ''}`}
        />
      </button>
    </div>
  );
};

