
import React, { useState, useEffect, useRef } from 'react';
import { BookProject, BookOutline, WritingStyle, User } from '../types';
import { generateOutline } from '../services/gemini';
import { PricingService, ModelOption } from '../services/pricing';
import { isNonfiction } from '../services/prompts';
import { readApiJson } from '../services/http';
import { SourceInput } from './SourceInput';
import { OutlineBuilder } from './OutlineBuilder';
import { BookReader } from './BookReader';
import { PWAInstallButton } from './PWAInstallButton';
import { BookOpen, PenTool, FileAudio, ArrowRight, ChevronLeft, Check, Wand2, Feather, AlertTriangle, Sparkles, Cpu } from 'lucide-react';

interface ProjectEditorProps {
  project: BookProject;
  onUpdateProject: (project: BookProject) => void;
  onBack: () => void;
  onStartGeneration: (style: WritingStyle) => void;
  isGeneratingGlobal: boolean;
  user?: User;
}

const STEPS = [
  { id: 0, title: 'Materials', icon: FileAudio },
  { id: 1, title: 'Outline', icon: BookOpen },
  { id: 2, title: 'Manuscript', icon: PenTool },
];

const WRITING_STYLES: {id: WritingStyle, name: string, description: string}[] = [
  { id: 'standard', name: 'Balanced', description: 'Clear, engaging, and professional.' },
  { id: 'educational_nonfiction', name: 'History & Current Affairs', description: 'Educational, witty nonfiction grounded in real sources. No invented stories.' },
  { id: 'literary', name: 'Literary', description: 'Rich descriptions, metaphoric, and elevated prose.' },
  { id: 'humorous', name: 'Witty', description: 'Light-hearted, clever, and entertaining.' },
  { id: 'sarcastic', name: 'Edgy', description: 'Sharp wit, heavy sarcasm, and adult humor.' },
  { id: 'technical', name: 'Technical', description: 'Precise, factual, and educational.' },
  { id: 'simple', name: 'Accessible', description: 'Easy to read, simple vocabulary, direct.' },
];

const SHOW_ALL_MODELS_KEY = 'ebookai_show_all_models';

const readShowAllModels = (): boolean => {
  try {
    return localStorage.getItem(SHOW_ALL_MODELS_KEY) === 'true';
  } catch {
    return false;
  }
};

const modelPriceLabel = (model: ModelOption): string => {
  if (model.imageOutput) {
    return model.pricePerImage ? `≈ $${model.pricePerImage.toFixed(2)}/image` : 'paid per image';
  }
  if (model.isFree) return 'free';
  return `$${(model.pricing?.prompt || 0).toFixed(2)}/M input`;
};

const modelLabel = (model: ModelOption): string => `${model.name} — ${modelPriceLabel(model)}`;

/** Renders the recommended shortlist, expanding to the full catalog on request. */
const ModelOptions: React.FC<{ models: ModelOption[]; selectedId: string; showAll: boolean }> = ({
  models,
  selectedId,
  showAll,
}) => {
  if (models.length === 0) {
    return <option value="" disabled>Loading OpenRouter models…</option>;
  }

  const recommended = models.filter((model) => model.recommended);
  const others = models.filter((model) => !model.recommended);
  const selected = models.find((model) => model.id === selectedId);
  const showSelectedFallback = !showAll && Boolean(selectedId) && !recommended.some((model) => model.id === selectedId);

  return (
    <>
      {showSelectedFallback && (
        <option value={selectedId}>{selected ? modelLabel(selected) : selectedId}</option>
      )}
      {recommended.length > 0 && (
        <optgroup label="Recommended">
          {recommended.map((model) => (
            <option key={model.id} value={model.id}>{modelLabel(model)}</option>
          ))}
        </optgroup>
      )}
      {showAll && others.some((model) => model.isFree) && (
        <optgroup label="Other free models">
          {others.filter((model) => model.isFree).map((model) => (
            <option key={model.id} value={model.id}>{modelLabel(model)}</option>
          ))}
        </optgroup>
      )}
      {showAll && others.some((model) => !model.isFree) && (
        <optgroup label="Paid models">
          {others.filter((model) => !model.isFree).map((model) => (
            <option key={model.id} value={model.id}>{modelLabel(model)}</option>
          ))}
        </optgroup>
      )}
    </>
  );
};

export const ProjectEditor: React.FC<ProjectEditorProps> = ({ 
  project, 
  onUpdateProject, 
  onBack,
  onStartGeneration,
  isGeneratingGlobal,
  user
}) => {
  const projectRef = useRef(project);
  projectRef.current = project;
  const [isProcessing, setIsProcessing] = useState(false);
  const [localTitle, setLocalTitle] = useState(project.title);
  const selectedStyle = project.settings?.writingStyle || 'standard';
  const nonfiction = isNonfiction(selectedStyle);
  const automaticResearch = nonfiction && project.settings?.automaticResearch !== false;
  const researchTopic = project.settings?.researchTopic?.trim() || '';
  const [researchWarnings, setResearchWarnings] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [textModels, setTextModels] = useState<ModelOption[]>(PricingService.getModels());
  const [imageModels, setImageModels] = useState<ModelOption[]>(PricingService.getImageModels());
  const [showAllModels, setShowAllModels] = useState<boolean>(readShowAllModels);
  const [selectedTextModel, setSelectedTextModel] = useState<string>(
    project.settings?.textModel || PricingService.getSelectedTextModel()
  );
  const [selectedCoverModel, setSelectedCoverModel] = useState<string>(
    project.settings?.coverModel || PricingService.getSelectedCoverModel()
  );
  const selectedTextOption = PricingService.getModel(selectedTextModel);
  const selectedCoverOption = PricingService.getModel(selectedCoverModel);

  useEffect(() => {
    const unsubscribe = PricingService.subscribe(() => {
      setTextModels([...PricingService.getModels()]);
      setImageModels([...PricingService.getImageModels()]);
    });
    PricingService.refreshLiveModels().then(() => {
      setTextModels([...PricingService.getModels()]);
      setImageModels([...PricingService.getImageModels()]);

      // First run: land on the recommended shortlist instead of an unlisted default.
      if (!projectRef.current.settings?.textModel && !PricingService.hasStoredTextModel()) {
        const firstWriting = PricingService.getRecommendedModels('writing')[0];
        if (firstWriting) {
          setSelectedTextModel(firstWriting.id);
          PricingService.setSelectedTextModel(firstWriting.id);
        }
      }

      setSelectedCoverModel((current) => {
        if (current) return current;
        const firstImage = PricingService.getRecommendedModels('image')[0];
        if (!firstImage) return '';
        PricingService.setSelectedCoverModel(firstImage.id);
        return firstImage.id;
      });
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const handleTextModelChange = (value: string) => {
    setSelectedTextModel(value);
    PricingService.setSelectedTextModel(value);
    updateProject({ settings: { ...projectRef.current.settings, textModel: value } });
  };

  const handleCoverModelChange = (value: string) => {
    setSelectedCoverModel(value);
    PricingService.setSelectedCoverModel(value);
    updateProject({ settings: { ...projectRef.current.settings, coverModel: value } });
  };

  const toggleShowAllModels = (next: boolean) => {
    setShowAllModels(next);
    try {
      localStorage.setItem(SHOW_ALL_MODELS_KEY, String(next));
    } catch {
      // ignore storage errors
    }
  };

  // Sync title state if project changes externally
  useEffect(() => {
    setLocalTitle(project.title);
  }, [project.id, project.title]);

  // Auto-start generation when entering Step 2 if chapters are empty or missing
  useEffect(() => {
    if (project.currentStep === 2 && project.outline) {
       const needsGeneration = project.chapters.length === 0 || project.chapters.length < project.outline.chapters.length;
       
       if (needsGeneration && !isProcessing && !isGeneratingGlobal && !error) {
         onStartGeneration(selectedStyle);
       }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.currentStep, project.outline]);

  const updateProject = (updates: Partial<BookProject>) => {
    onUpdateProject({
      ...projectRef.current,
      ...updates,
      lastModified: Date.now()
    });
  };

  const handleTitleBlur = () => {
     if (localTitle !== project.title) {
       updateProject({ title: localTitle });
     }
  };

  const fetchResearch = async () => {
    if (!researchTopic) throw new Error('Enter a research topic before searching.');
    const response = await fetch('/api/research', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic: researchTopic }), signal: AbortSignal.timeout(35000),
    });
    const data = await readApiJson(response, 'Research service');
    if (!response.ok || !Array.isArray(data.sources) || !data.sources.length) {
      throw new Error(data.error || 'No research sources were returned. Try another topic.');
    }
    setResearchWarnings(data.warnings || []);
    return [...project.sources.filter(source => !source.research), ...data.sources];
  };

  const handleRefreshResearch = async () => {
    setIsProcessing(true);
    setError(null);
    try {
      updateProject({ sources: await fetchResearch() });
    } catch (e: any) {
      setError(e.message || 'Research could not be retrieved. Please retry.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateOutline = async () => {
    if (!project.sources.length && !automaticResearch) return;
    setIsProcessing(true);
    setError(null);
    try {
      let sources = project.sources;
      if (automaticResearch && (!sources.some(source => source.research?.query === researchTopic) ||
          sources.some(source => source.research && source.research.query !== researchTopic))) {
        sources = await fetchResearch();
        updateProject({ sources });
      }
      const generatedOutline = await generateOutline(sources, project.customInstruction, {
        style: selectedStyle,
        pov: project.settings?.pov,
        tense: project.settings?.tense,
        targetDepth: project.settings?.targetDepth,
        model: selectedTextModel,
      });
      updateProject({
        sources,
        outline: generatedOutline,
        chapters: [],
        currentStep: 1,
        title: generatedOutline.title
      });
      setLocalTitle(generatedOutline.title);
    } catch (e: any) {
      setError(e.message || "Failed to generate outline.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateCoverArtwork = (coverImage: string | undefined) => {
    const latest = projectRef.current;
    if (latest.outline) updateProject({ outline: { ...latest.outline, coverImage } });
  };

  const handleUpdateOutline = (updatedOutline: BookOutline) => {
    updateProject({ outline: updatedOutline });
  };

  const navigateStep = (step: number) => {
    if (step <= project.currentStep) {
      updateProject({ currentStep: step });
    } else {
      if (step === 1 && project.outline) updateProject({ currentStep: 1 });
      if (step === 2 && project.outline && project.chapters.length > 0) updateProject({ currentStep: 2 });
    }
  };

  return (
    <div className="min-h-[100dvh] bg-white flex flex-col print:block text-slate-900 pb-16 md:pb-0">
      
      {/* Top Bar */}
      <div className="h-14 md:h-16 border-b border-slate-200 flex items-center px-3 md:px-6 bg-white/90 backdrop-blur-md sticky top-0 z-40 print:hidden no-print pt-safe">
        <button 
          onClick={onBack}
          className="min-h-[44px] min-w-[44px] px-2 -ml-1 text-slate-500 hover:text-blue-700 hover:bg-blue-50 rounded-xl transition-colors flex items-center gap-1 text-sm font-medium group shrink-0"
        >
          <ChevronLeft size={20} className="group-hover:-translate-x-0.5 transition-transform" />
          <span className="hidden sm:inline">Library</span>
        </button>
        
        <div className="h-5 w-px bg-slate-200 mx-1.5 md:mx-4 shrink-0"></div>

        <input 
          value={localTitle}
          onChange={(e) => setLocalTitle(e.target.value)}
          onBlur={handleTitleBlur}
          className="font-serif font-bold text-base md:text-lg text-slate-900 bg-transparent border border-transparent hover:border-slate-200 focus:border-blue-400 focus:ring-0 px-2 md:px-3 py-1.5 w-full max-w-lg rounded-md transition-all truncate"
        />

        <div className="flex-1"></div>

        <div className="mr-2">
          <PWAInstallButton variant="header" />
        </div>

        {/* Desktop Step Progress */}
        <div className="hidden md:flex items-center gap-2 bg-slate-50 p-1 rounded-lg border border-slate-100 shrink-0">
            {STEPS.map((step, idx) => {
               const isActive = project.currentStep === step.id;
               const isCompleted = project.currentStep > step.id;
               const hasData = (step.id === 1 && !!project.outline) || (step.id === 2 && project.chapters.length > 0);
               const canClick = isCompleted || isActive || hasData;

               return (
                 <button
                   key={step.id}
                   onClick={() => canClick && navigateStep(step.id)}
                   disabled={!canClick}
                   className={`flex items-center gap-2 text-xs font-medium px-3 py-1.5 rounded-md transition-all ${
                     isActive ? 'bg-white text-blue-700 shadow-sm border border-slate-200' : 
                     (canClick || isCompleted) ? 'text-blue-600 hover:bg-blue-50' : 'text-slate-400 cursor-not-allowed'
                   }`}
                 >
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${isActive ? 'bg-blue-100 text-blue-700' : (isCompleted || hasData) ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-500'}`}>
                      {(isCompleted || hasData) ? <Check size={8} strokeWidth={3} /> : idx + 1}
                    </span>
                    {step.title}
                 </button>
               )
            })}
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex-1 bg-white overflow-y-auto print:overflow-visible scrollbar-hide">
        {error && (
            <div className="bg-red-50 border-b border-red-200 p-4 sticky top-0 z-40 flex items-center gap-3 animate-in slide-in-from-top-2">
                <AlertTriangle className="text-red-600 shrink-0" size={20} />
                <div className="flex-1 text-red-800 text-sm font-medium">{error}</div>
                <button onClick={() => setError(null)} className="min-h-[40px] px-2 text-red-500 hover:text-red-800 font-bold text-sm">Dismiss</button>
            </div>
        )}

        <div className={`mx-auto print:p-0 print:max-w-none transition-all ${project.currentStep === 2 && project.outline ? 'max-w-full p-0 md:px-6 md:py-12 md:max-w-6xl' : 'max-w-6xl px-4 py-6 md:px-6 md:py-12 pb-24'}`}>
          
          {project.currentStep === 0 && (
            <div className="animate-in fade-in slide-in-from-bottom-2 print:hidden max-w-4xl mx-auto no-print">
              <div className="mb-6 sm:mb-10 text-center">
                <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mx-auto mb-3 sm:mb-4 text-blue-600">
                   <FileAudio size={24} />
                </div>
                <h2 className="text-2xl sm:text-3xl font-serif font-bold text-slate-900 mb-2 sm:mb-3">Source Material</h2>
                <p className="text-slate-500 text-sm sm:text-lg max-w-xl mx-auto leading-relaxed">Gather your ideas, recordings, research, and notes to shape your book.</p>
              </div>
              
              <fieldset disabled={isProcessing || isGeneratingGlobal}>
              <SourceInput 
                sources={project.sources} 
                onUpdate={(newSources) => updateProject({ sources: newSources })} 
              />
              </fieldset>
              
              <fieldset disabled={isProcessing || isGeneratingGlobal} className="mt-12 bg-slate-50 border border-slate-100 rounded-xl p-6 space-y-6">
                 <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
                    <Feather size={18} className="text-blue-600" />
                    <h3 className="font-bold text-slate-800 text-lg">Manuscript Writing Settings</h3>
                 </div>

                 {/* Style Selector */}
                 <div>
                   <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Writing Style & Tone</label>
                   <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {WRITING_STYLES.map(style => (
                         <button
                           key={style.id}
                           type="button"
                           aria-pressed={selectedStyle === style.id}
                           onClick={() => updateProject({ settings: { ...project.settings, writingStyle: style.id } })}
                           className={`text-left p-3 rounded-lg border transition-all ${selectedStyle === style.id ? 'bg-white border-blue-500 shadow-md ring-1 ring-blue-500' : 'bg-white border-slate-200 hover:border-blue-300 hover:shadow-sm'}`}
                         >
                            <div className={`font-bold text-sm mb-1 ${selectedStyle === style.id ? 'text-blue-700' : 'text-slate-700'}`}>{style.name}</div>
                            <div className="text-xs text-slate-500 leading-snug">{style.description}</div>
                         </button>
                      ))}
                   </div>
                 </div>

                 {nonfiction && (
                   <div className="space-y-3 border border-blue-200 bg-white rounded-lg p-4">
                     <h4 className="font-bold text-slate-800">Research &amp; factual grounding</h4>
                     <p className="text-sm text-slate-600">Explain real events and ideas with wit, context, and citations. Missing support is flagged instead of filled with invented scenes or statistics.</p>
                     <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                       <input type="checkbox" checked={automaticResearch}
                         onChange={e => updateProject({ settings: { ...project.settings, automaticResearch: e.target.checked } })} />
                       Automatically research this topic for free
                     </label>
                     <p className="text-xs text-slate-600">Searches English Wikipedia and saves dated excerpts with source links. This is background research, not a live news feed or primary-source fact check. Add official reports or recent data as notes for stronger coverage. All AI uses your chosen OpenRouter model; no paid search plugin.</p>
                     <label htmlFor="research-topic" className="block text-sm font-medium text-slate-700">Research topic</label>
                     <input id="research-topic" maxLength={200} value={project.settings?.researchTopic || ''}
                       onChange={e => updateProject({ settings: { ...project.settings, researchTopic: e.target.value } })}
                       placeholder="e.g., Industrial Revolution in Britain"
                       className="w-full min-h-[44px] rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                     <button type="button" onClick={handleRefreshResearch} disabled={!researchTopic || isProcessing || isGeneratingGlobal}
                       className="min-h-[44px] px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-sm disabled:opacity-50">
                       {isProcessing ? 'Working…' : 'Search / Refresh Research'}
                     </button>
                     <p className="text-xs text-slate-600">Saved research is reused for the outline, chapters, and edits. Refresh to collect a new snapshot. Existing chapters keep their text until you edit them.</p>
                     {researchWarnings.map(warning => <p key={warning} role="status" className="text-sm text-amber-800">{warning}</p>)}
                     {project.sources.filter(source => source.research).map(source => (
                       <p key={source.id} className="text-xs text-slate-600 break-words">
                         <a href={source.research!.url} target="_blank" rel="noreferrer" className="text-blue-700 underline">{source.name}</a>
                         {' · Retrieved '}{new Date(source.research!.retrievedAt).toLocaleDateString()}
                         {source.research!.revisionDate && ` · Page updated ${new Date(source.research!.revisionDate).toLocaleDateString()}`}
                       </p>
                     ))}
                   </div>
                 )}

                 {/* Advanced Manuscript Selectors: POV, Tense, Chapter Depth */}
                 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                   {!nonfiction && <>
                   <div>
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Point of View (POV)</label>
                     <select
                       value={project.settings?.pov || 'third_limited'}
                       onChange={(e) => updateProject({ settings: { ...project.settings, pov: e.target.value as any } })}
                       className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                     >
                       <option value="third_limited">Third-Person Limited (He/She)</option>
                       <option value="first">First-Person (I/We)</option>
                       <option value="second">Second-Person (You)</option>
                       <option value="omniscient">Third-Person Omniscient</option>
                     </select>
                   </div>

                   <div>
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Narrative Tense</label>
                     <select
                       value={project.settings?.tense || 'past'}
                       onChange={(e) => updateProject({ settings: { ...project.settings, tense: e.target.value as any } })}
                       className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                     >
                       <option value="past">Past Tense ("He walked into the room")</option>
                       <option value="present">Present Tense ("He walks into the room")</option>
                     </select>
                   </div>

                   </>}
                   <div>
                     <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">Target Chapter Depth</label>
                     <select
                       value={project.settings?.targetDepth || 'standard'}
                       onChange={(e) => updateProject({ settings: { ...project.settings, targetDepth: e.target.value as any } })}
                       className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                     >
                       <option value="short">Short (~1,200 – 1,500 words)</option>
                       <option value="standard">Standard (~2,200 – 2,800 words)</option>
                       <option value="epic">Epic (~3,200 – 4,000 words)</option>
                     </select>
                   </div>
                 </div>

                 {/* OpenRouter AI Model Selectors */}
                 <div className="space-y-3 pt-2 border-t border-slate-200/80">
                   <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                     <div>
                       <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                         <Cpu size={14} className="text-blue-600" />
                         Writing &amp; Outline Model
                       </label>
                       <select
                         value={selectedTextModel}
                         onChange={(e) => handleTextModelChange(e.target.value)}
                         className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                       >
                         <ModelOptions models={textModels} selectedId={selectedTextModel} showAll={showAllModels} />
                       </select>
                       <p className="text-[11px] text-slate-500 mt-1">
                         {selectedTextOption?.description || 'Drafts outlines and chapters with your sources.'}
                       </p>
                       <p className="text-[11px] text-slate-500 mt-0.5">
                         {PricingService.isModelFree(selectedTextModel)
                           ? 'Free on OpenRouter — no charge for writing.'
                           : 'Paid model — usage is billed to your OpenRouter account.'}
                       </p>
                     </div>

                     <div>
                       <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                         <Wand2 size={14} className="text-blue-600" />
                         Cover &amp; Illustration Model
                       </label>
                       <select
                         value={selectedCoverModel}
                         onChange={(e) => handleCoverModelChange(e.target.value)}
                         className="w-full bg-white border border-slate-200 text-slate-800 text-sm rounded-lg px-3 py-2.5 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                       >
                         <ModelOptions models={imageModels} selectedId={selectedCoverModel} showAll={showAllModels} />
                       </select>
                       <p className="text-[11px] text-slate-500 mt-1">
                         Paid image models render covers and chapter illustrations from your art direction prompts. Free text models cannot produce images.
                       </p>
                       <p className="text-[11px] text-slate-500 mt-0.5">
                         {selectedCoverOption
                           ? `${modelPriceLabel(selectedCoverOption)} — billed per generated image.`
                           : 'No image model loaded yet. Connect to OpenRouter and reopen this screen.'}
                       </p>
                     </div>
                   </div>

                   <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
                     <input
                       type="checkbox"
                       checked={showAllModels}
                       onChange={(e) => toggleShowAllModels(e.target.checked)}
                       className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                     />
                     Show all OpenRouter models (advanced)
                   </label>
                 </div>

                 {/* Two-Pass Generation Toggle */}
                 <div className="flex items-center justify-between bg-white p-3.5 rounded-lg border border-slate-200">
                   <div>
                     <div className="text-sm font-bold text-slate-800">Two-Pass AI Polish Pass (Optional)</div>
                     <div className="text-xs text-slate-500">Executes a secondary style refinement pass on every chapter (uses 2x API requests — leave unchecked for fastest generation).</div>
                   </div>
                   <input
                     type="checkbox"
                     checked={Boolean(project.settings?.twoPassPolish)}
                     onChange={(e) => updateProject({ settings: { ...project.settings, twoPassPolish: e.target.checked } })}
                     className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500 cursor-pointer"
                   />
                 </div>
              </fieldset>

              <div className="mt-6 bg-amber-50 border border-amber-100 rounded-xl p-6">
                  <div className="flex items-center gap-2 mb-3 text-amber-800">
                      <Sparkles size={18} />
                      <h3 className="font-bold">Special Instructions (Optional)</h3>
                  </div>
                  <textarea
                      value={project.customInstruction || ''}
                      onChange={(e) => updateProject({ customInstruction: e.target.value })}
                      placeholder="e.g., 'Focus heavily on the childhood years', 'Make it a dark thriller', 'Keep chapters short', 'Avoid metaphors'..."
                      className="w-full p-4 bg-white border border-amber-200 rounded-lg focus:ring-2 focus:ring-amber-400 outline-none text-slate-800 placeholder:text-slate-400 text-sm"
                      rows={3}
                  />
              </div>

              <div className="flex justify-center pt-8 mt-4">
                <button 
                  onClick={handleCreateOutline}
                  disabled={(!project.sources.length && !automaticResearch) || (automaticResearch && !researchTopic) || isProcessing || isGeneratingGlobal || project.sources.some(s => s.isProcessing)}
                  className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white pl-8 pr-6 py-4 rounded-full font-bold text-lg transition-all shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 hover:-translate-y-1 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed disabled:translate-y-0"
                >
                  {isProcessing ? 'Analyzing...' : 'Generate Structure'}
                  {!isProcessing && <div className="bg-blue-500 rounded-full p-1"><ArrowRight size={16} /></div>}
                </button>
              </div>
            </div>
          )}

          {project.currentStep === 1 && project.outline && (
            <div className="animate-in fade-in slide-in-from-bottom-2 print:hidden no-print">
               <OutlineBuilder 
                 coverArtPrompt={project.settings?.coverArtPrompt || ''}
                 onCoverArtPromptChange={coverArtPrompt => updateProject({ settings: { ...projectRef.current.settings, coverArtPrompt } })}
                 coverModel={selectedCoverModel}
                 nonfiction={nonfiction}
                 outline={project.outline} 
                 isGenerating={isProcessing}
                 onRegenerate={handleCreateOutline}
                 onCoverArtworkChange={handleUpdateCoverArtwork}
                 onUpdateOutline={handleUpdateOutline}
               />
               
               <div className="flex flex-col items-center pt-16 pb-8">
                  <button 
                   onClick={() => updateProject({ currentStep: 2 })}
                   className="flex items-center gap-3 bg-blue-600 hover:bg-blue-500 text-white pl-8 pr-6 py-4 rounded-full font-bold text-lg transition-all shadow-lg shadow-blue-600/30 hover:shadow-blue-600/50 hover:-translate-y-1"
                 >
                   {project.chapters.length > 0 ? 'Continue Writing' : 'Start Writing Manuscript'}
                   <div className="bg-blue-500 rounded-full p-1"><Wand2 size={16} /></div>
                 </button>
                 {project.chapters.length === 0 && (
                   <p className="text-sm text-slate-400 mt-4 font-medium">
                      This process may take a few moments per chapter.
                   </p>
                 )}
               </div>
            </div>
          )}

          {project.currentStep === 2 && project.outline && (
            <BookReader 
              coverArtPrompt={project.settings?.coverArtPrompt || ''}
              onCoverArtPromptChange={coverArtPrompt => updateProject({ settings: { ...projectRef.current.settings, coverArtPrompt } })}
              writingStyle={selectedStyle}
              sources={project.sources}
              customInstruction={project.customInstruction}
              textModel={selectedTextModel}
              coverModel={selectedCoverModel}
              outline={project.outline} 
              chapters={project.chapters} 
              selectedVoice={project.audioVoice || 'Kore'}
              onVoiceChange={(voice) => updateProject({ audioVoice: voice })}
              onChapterUpdate={(updatedChapter, updates) => {
                 const newChapters = projectRef.current.chapters.map(c => c.chapterNumber === updatedChapter.chapterNumber ? { ...c, ...(updates || updatedChapter) } : c);
                 updateProject({ chapters: newChapters });
              }}
              onCoverArtworkChange={handleUpdateCoverArtwork}
              user={user}
            />
          )}

        </div>
      </div>
    </div>
  );
};
