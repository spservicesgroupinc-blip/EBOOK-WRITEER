
import React, { useState, useRef, useEffect } from 'react';
import { ChapterContent, BookOutline, User, Source, WritingStyle } from '../types';
import { isNonfiction } from '../services/prompts';
import { buildIllustrationPrompt, buildCoverIllustrationPrompt } from '../services/illustrations';
import { ArtDirectionInput } from './ArtDirectionInput';
import { ChevronLeft, ChevronRight, Loader2, Download, PenLine, Save, Headphones, Play, Square, FileText, Image as ImageIcon, Wand2, Menu, X, Palette, RefreshCw } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { generateSpeech, generateImage, refineChapterText, formatImageSrc } from '../services/gemini';
import { PricingService, FreeModelOption } from '../services/pricing';
import { Notification } from './Notification';
import { CloudService } from '../services/cloud';
import { generateBookPdf } from '../services/pdf';

interface BookReaderProps {
  coverArtPrompt?: string;
  onCoverArtPromptChange?: (prompt: string) => void;
  writingStyle?: WritingStyle;
  sources?: Source[];
  customInstruction?: string;
  textModel?: string;
  outline: BookOutline;
  chapters: ChapterContent[];
  onChapterUpdate?: (chapter: ChapterContent, updates?: Partial<ChapterContent>) => void;
  selectedVoice?: string;
  onVoiceChange?: (voice: string) => void;
  onUpdateOutline?: (outline: BookOutline) => void;
  user?: User;
}

// Audio Cache
const audioCache = new Map<string, AudioBuffer>();

function decode(base64: string) {
  try {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (e) {
    console.error("Audio decoding failed", e);
    return new Uint8Array(0);
  }
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number = 24000,
  numChannels: number = 1
): Promise<AudioBuffer> {
  // Strip 44-byte RIFF WAV header if present (gemini-3.8-flash-lite-tts unary returns WAV)
  let pcmBytes = data;
  if (
    data.byteLength > 44 &&
    data[0] === 0x52 && // 'R'
    data[1] === 0x49 && // 'I'
    data[2] === 0x46 && // 'F'
    data[3] === 0x46    // 'F'
  ) {
    pcmBytes = data.subarray(44);
  }

  let bufferToUse = pcmBytes.buffer;
  let byteOffset = pcmBytes.byteOffset;
  let byteLength = pcmBytes.byteLength;

  if (byteLength % 2 !== 0) {
      const newBuffer = new Uint8Array(byteLength - 1);
      newBuffer.set(pcmBytes.subarray(0, byteLength - 1));
      bufferToUse = newBuffer.buffer;
      byteOffset = 0;
      byteLength = newBuffer.byteLength;
  }

  const dataInt16 = new Int16Array(bufferToUse, byteOffset, byteLength / 2);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

export const BookReader: React.FC<BookReaderProps> = ({ 
  coverArtPrompt = '', onCoverArtPromptChange,
  writingStyle, sources, customInstruction, textModel,
  outline, 
  chapters, 
  onChapterUpdate, 
  selectedVoice, 
  onVoiceChange,
  onUpdateOutline,
  user
}) => {
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [isExportingDocs, setIsExportingDocs] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [polishInstruction, setPolishInstruction] = useState('');
  const [isPolishing, setIsPolishing] = useState(false);
  const [isCoverGenerating, setIsCoverGenerating] = useState(false);
  const [isChapterImageGenerating, setIsChapterImageGenerating] = useState(false);
  const [notification, setNotification] = useState<{message: string, type: 'error' | 'success'} | null>(null);
  const [coverModels, setCoverModels] = useState<FreeModelOption[]>(PricingService.getCoverModels());
  const [selectedCoverModel, setSelectedCoverModel] = useState<string>(PricingService.getSelectedCoverModel());

  useEffect(() => {
    const unsubscribe = PricingService.subscribe((summary) => {
      setSelectedCoverModel(summary.selectedCoverModel);
      setCoverModels([...PricingService.getCoverModels()]);
    });
    return () => {
      unsubscribe();
    };
  }, []);
  
  // PDF Generation State: We use a specific mode to render the print layout
  const [isPdfMode, setIsPdfMode] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const currentChapter = chapters[currentChapterIndex];

  useEffect(() => {
    stopAudio();
  }, [currentChapterIndex]);

  // --- PDF GENERATION LOGIC ---
  const handleDownloadPdf = async () => {
    if (isPdfMode) return;
    setIsPdfMode(true);
    try {
      await generateBookPdf(outline, chapters);
      showNotification("PDF Downloaded!", 'success');
    } catch (e: any) {
      console.error("PDF generation failed:", e);
      showNotification(e?.message || "PDF Generation Error", 'error');
    } finally {
      setIsPdfMode(false);
    }
  };

  const showNotification = (message: string, type: 'error' | 'success' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  const stopAudio = () => {
    if (audioSourceRef.current) {
      try { audioSourceRef.current.stop(); } catch(e) {}
      audioSourceRef.current = null;
    }
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch(e) {}
    }
    setIsPlaying(false);
  };

  const updatePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.playbackRate.value = speed;
      } catch (e) {
        console.warn("Could not set playback rate", e);
      }
    }
  };

  const playChapterAudio = async () => {
    if (isPlaying) { stopAudio(); return; }
    if (!currentChapter?.content) return;

    let ctx = audioContextRef.current;
    if (!ctx) {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      ctx = new AudioContextClass();
      audioContextRef.current = ctx;
    }

    if (ctx.state === 'suspended') await ctx.resume();

    const cacheKey = `${currentChapter.chapterNumber}-${selectedVoice}-${currentChapter.content.length}`;
    if (audioCache.has(cacheKey)) {
        playBuffer(audioCache.get(cacheKey)!);
        return;
    }

    setAudioLoading(true);
    try {
      const textToSpeak = currentChapter.content.slice(0, 4000);
      const pcmBase64 = await generateSpeech(textToSpeak, selectedVoice || 'Kore');
      if (pcmBase64) {
        const pcmData = decode(pcmBase64);
        const audioBuffer = await decodeAudioData(pcmData, ctx, 24000);
        audioCache.set(cacheKey, audioBuffer);
        playBuffer(audioBuffer);
      } else if ('speechSynthesis' in window) {
        // Free Tier local browser speech fallback if Gemini TTS quota is reached
        window.speechSynthesis.cancel();
        const cleanText = textToSpeak.replace(/[#*_`~>]/g, '');
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = playbackSpeed;
        utterance.onend = () => setIsPlaying(false);
        utterance.onerror = () => setIsPlaying(false);
        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
      } else {
        throw new Error("Audio generation failed");
      }
    } catch (err: any) {
      showNotification(err.message || "Audio playback failed", 'error');
    } finally {
      setAudioLoading(false);
    }
  };

  const playBuffer = (buffer: AudioBuffer) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (audioSourceRef.current) try { audioSourceRef.current.stop(); } catch(e) {}
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackSpeed;
    source.connect(ctx.destination);
    source.onended = () => { setIsPlaying(false); audioSourceRef.current = null; };
    audioSourceRef.current = source;
    source.start(0);
    setIsPlaying(true);
  };

  const handleExportDocs = async () => {
    if (!user) {
        showNotification("Please log in to export to Google Docs.", 'error');
        return;
    }
    setIsExportingDocs(true);
    try {
      const url = await CloudService.exportToDoc(
        user,
        outline.title,
        outline.description,
        chapters.map(c => ({
            chapterNumber: c.chapterNumber,
            title: c.title,
            content: c.content
        }))
      );
      showNotification("Export Successful! Opening Doc...");
      window.open(url, '_blank');
    } catch (e: any) {
      showNotification("Docs export failed: " + e.message, 'error');
    } finally {
      setIsExportingDocs(false);
    }
  };

  const startEditing = () => { setEditContent(currentChapter.content); setIsEditing(true); };
  const saveEditing = () => {
    if (onChapterUpdate) onChapterUpdate({ ...currentChapter, content: editContent });
    setIsEditing(false);
    showNotification("Changes saved.");
  };

  const handlePolish = async () => {
    if (!polishInstruction.trim()) return;
    setIsPolishing(true);
    try {
      const polished = await refineChapterText(editContent, polishInstruction, textModel, { style: writingStyle, sources, customInstruction });
      setEditContent(polished);
      setPolishInstruction('');
    } catch (e) {
      showNotification("Polish failed.", 'error');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleGenerateBookCover = async () => {
    if (!onUpdateOutline) return;
    setIsCoverGenerating(true);
    try {
      const prompt = buildCoverIllustrationPrompt(outline, coverArtPrompt);
      
      const base64Image = await generateImage(prompt, '3:4', selectedCoverModel, 'cover');
      onUpdateOutline({
        ...outline,
        coverImage: base64Image
      });
      showNotification("Cover Generated!");
    } catch (e: any) {
      showNotification(e.message || 'Failed to generate cover. Try another free art model.', 'error');
    } finally {
      setIsCoverGenerating(false);
    }
  };

  const handleGenerateChapterImage = async () => {
    if (!currentChapter || !onChapterUpdate) return;
    setIsChapterImageGenerating(true);
    try {
      const prompt = buildIllustrationPrompt(currentChapter, outline, writingStyle);
      const base64 = await generateImage(prompt, '16:9', selectedCoverModel, 'chapter');
      onChapterUpdate({ ...currentChapter, image: base64 }, { image: base64 });
      showNotification('Chapter illustration generated.');
    } catch (e: any) {
      showNotification(e.message || 'Failed to generate illustration. Try another free art model.', 'error');
    } finally {
      setIsChapterImageGenerating(false);
    }
  };

  return (
    <>
      {notification && (
        <Notification message={notification.message} type={notification.type} onClose={() => setNotification(null)} />
      )}

      {isPdfMode && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex flex-col items-center justify-center p-6">
          <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full flex flex-col items-center text-center border border-slate-100">
             <Loader2 size={48} className="animate-spin text-blue-600 mb-4" />
             <h2 className="text-xl font-bold text-slate-900 mb-1.5 font-serif">Typesetting PDF Book</h2>
             <p className="text-sm text-slate-500">
               Formatting cover art, table of contents, chapter typography, and page numbers...
             </p>
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row h-[calc(100vh-4rem)] bg-slate-50 relative overflow-hidden">
        
        {/* Sidebar */}
        <div className={`
            flex-col bg-white border-r border-slate-200 flex-shrink-0 transition-all duration-300 z-30
            ${isSidebarOpen ? 'fixed inset-0 w-full flex md:static md:w-80' : 'hidden md:flex md:w-0 md:overflow-hidden'}
        `}>
          <div className="p-6 border-b border-slate-100 flex-shrink-0 flex justify-between items-start bg-slate-50/50">
             <div className="min-w-0 pr-2 flex-1">
               <h3 className="font-bold text-slate-900 font-serif mb-1 truncate">{outline.title}</h3>
               <p className="text-xs text-slate-400 uppercase tracking-widest font-bold">Table of Contents</p>
             </div>
             <button onClick={() => setIsSidebarOpen(false)} className="md:hidden p-1 text-slate-400 hover:text-slate-600"><X size={24} /></button>
          </div>

          {/* Book Cover in Sidebar */}
          <div className="p-4 border-b border-slate-100 flex flex-col items-center bg-white">
              <div className="w-full mb-2.5">
                <label className="flex items-center gap-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                  <Palette size={11} className="text-purple-500" />
                  Cover / Art Model (Free)
                </label>
                <select
                  value={selectedCoverModel}
                  onChange={(e) => {
                    setSelectedCoverModel(e.target.value);
                    PricingService.setSelectedCoverModel(e.target.value);
                  }}
                  className="w-full text-[11px] bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-purple-500 font-medium truncate"
                >
                  {coverModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>

              {onCoverArtPromptChange && <div className="w-full mb-3">
                <ArtDirectionInput label="Cover Art Prompt" value={coverArtPrompt} onChange={onCoverArtPromptChange} disabled={isCoverGenerating} />
              </div>}

              {outline.coverImage ? (
                  <div className="relative group w-32 shadow-lg rounded-md overflow-hidden mb-3">
                      <img src={formatImageSrc(outline.coverImage)} alt="Cover" className="w-full h-auto" />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <button 
                            onClick={handleGenerateBookCover}
                            disabled={isCoverGenerating}
                            className="p-2 bg-white text-slate-900 rounded-full hover:bg-blue-50 transition-colors"
                            title="Regenerate Cover"
                          >
                             {isCoverGenerating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                          </button>
                      </div>
                  </div>
              ) : (
                  <button 
                    onClick={handleGenerateBookCover}
                    disabled={isCoverGenerating}
                    className="w-full py-6 border-2 border-dashed border-slate-200 rounded-lg flex flex-col items-center justify-center text-slate-400 hover:text-blue-600 hover:border-blue-300 hover:bg-blue-50 transition-all mb-2"
                  >
                      {isCoverGenerating ? (
                          <Loader2 size={24} className="animate-spin mb-2" />
                      ) : (
                          <ImageIcon size={24} className="mb-2" />
                      )}
                      <span className="text-xs font-bold uppercase tracking-wide">
                          {isCoverGenerating ? 'Designing...' : 'Create Cover Art'}
                      </span>
                  </button>
              )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {chapters.map((chap, idx) => (
              <button
                key={chap.chapterNumber}
                onClick={() => { setCurrentChapterIndex(idx); if(window.innerWidth < 768) setIsSidebarOpen(false); }}
                className={`w-full text-left p-3 rounded-lg text-sm transition-all border group flex items-start gap-3 ${
                  currentChapterIndex === idx ? 'bg-blue-50 border-blue-200 text-blue-800' : 'border-transparent hover:bg-slate-50 text-slate-600'
                }`}
              >
                 <span className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold mt-0.5 ${
                    currentChapterIndex === idx ? 'bg-blue-200 text-blue-800' : 'bg-slate-100 text-slate-400 group-hover:bg-slate-200'
                 }`}>
                    {chap.chapterNumber === 0 ? 'i' : chap.chapterNumber}
                 </span>
                 <div>
                    <div className={`font-bold leading-tight ${currentChapterIndex === idx ? 'text-blue-900' : 'text-slate-700'}`}>
                        {chap.title}
                    </div>
                    {chap.isGenerating && (
                        <div className="flex items-center gap-1 text-[10px] text-blue-500 mt-1">
                            <Loader2 size={10} className="animate-spin" /> Writing...
                        </div>
                    )}
                 </div>
              </button>
            ))}
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 bg-white relative h-full overflow-hidden flex flex-col">
            {/* Mobile/Desktop Toolbar */}
             <div className="h-14 border-b border-slate-100 flex items-center justify-between px-3 sm:px-4 shrink-0 bg-white/90 backdrop-blur-sm z-20">
                <div className="flex items-center gap-2 min-w-0">
                   <button
                     onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                     className="min-h-[44px] px-2.5 text-slate-600 hover:text-blue-600 hover:bg-slate-50 rounded-xl flex items-center gap-1.5 text-xs font-semibold border border-slate-200/80 shrink-0"
                     title="Toggle Table of Contents"
                   >
                     <Menu size={18} />
                     <span className="sm:inline">Chapters ({chapters.length})</span>
                   </button>
                   <span className="md:hidden font-serif font-bold text-xs sm:text-sm text-slate-800 truncate">
                      {currentChapter?.title || "Loading..."}
                   </span>
                </div>
                
                <div className="flex items-center gap-1 shrink-0">
                   {currentChapter && !currentChapter.isGenerating && (
                      <>
                        <button 
                            onClick={handleDownloadPdf}
                            disabled={isPdfMode}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors disabled:opacity-50"
                            title="Download PDF"
                        >
                            {isPdfMode ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
                        </button>
                        <button 
                            onClick={handleExportDocs}
                            disabled={isExportingDocs}
                            className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors"
                            title="Export to Google Docs"
                        >
                            {isExportingDocs ? <Loader2 size={18} className="animate-spin" /> : <FileText size={18} />}
                        </button>
                        <button 
                            onClick={() => setIsEditing(!isEditing)}
                            className={`min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl transition-colors ${isEditing ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:text-blue-600 hover:bg-blue-50'}`}
                            title="Edit Mode"
                        >
                            <PenLine size={18} />
                        </button>
                      </>
                   )}
                </div>
             </div>

             {/* Content Area */}
             <div className="flex-1 overflow-y-auto px-4 py-6 sm:p-8 md:p-12 pb-36">
                {!currentChapter ? (
                  <div className="flex flex-col items-center justify-center h-full py-20 opacity-50">
                     <Loader2 className="animate-spin text-slate-300 mb-4" size={32} />
                     <p className="text-slate-400">Loading Chapter...</p>
                  </div>
                ) : (
                  <div className="max-w-3xl mx-auto animate-in fade-in slide-in-from-bottom-2 duration-500">
                     <div className="mb-6 sm:mb-8 border-b border-slate-100 pb-6 sm:pb-8 text-center">
                        <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em] mb-2 sm:mb-3">
                           {currentChapter.chapterNumber === 0 ? 'Introduction' : `Chapter ${currentChapter.chapterNumber}`}
                        </div>
                        <h1 className="text-2xl sm:text-3xl md:text-4xl font-serif font-bold text-slate-900 leading-tight">
                            {currentChapter.title}
                        </h1>
                     </div>

                     {currentChapter.isGenerating ? (
                        <div className="space-y-6 animate-pulse">
                            <div className="h-4 bg-slate-100 rounded w-full"></div>
                            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                            <div className="h-4 bg-slate-100 rounded w-full"></div>
                            <div className="h-4 bg-slate-100 rounded w-4/6"></div>
                            <div className="h-4 bg-slate-100 rounded w-5/6"></div>
                            <div className="mt-12 flex flex-col items-center justify-center text-blue-700 gap-1.5 font-medium bg-blue-50 border border-blue-100 py-4 px-4 rounded-xl text-center">
                                <div className="flex items-center gap-2 font-bold text-sm">
                                  <Wand2 size={16} className="animate-bounce" />
                                  <span>
                                    Writing your story ({chapters.filter(c => !c.isGenerating && Boolean(c.content)).length} of {chapters.length} chapters done)...
                                  </span>
                                </div>
                                <span className="text-xs text-blue-600/80">
                                  Background mode active — keeps writing &amp; saving even if you lock your phone
                                </span>
                            </div>
                        </div>
                     ) : (
                        <>
                           {isEditing ? (
                              <div className="space-y-4">
                                 {/* Edit Toolbar */}
                                 <div className="flex flex-wrap gap-2 items-center bg-slate-50 p-3 rounded-xl border border-slate-200 sticky top-0 z-10">
                                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                                       <div className="p-1.5 bg-purple-100 text-purple-600 rounded"><Wand2 size={14} /></div>
                                       <input 
                                         value={polishInstruction}
                                         onChange={(e) => setPolishInstruction(e.target.value)}
                                         placeholder="Instruction: e.g. 'Deepen sensory description' or 'Add dialogue'"
                                         className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-2 text-xs focus:ring-1 focus:ring-purple-500 outline-none"
                                       />
                                       <button 
                                          onClick={handlePolish}
                                          disabled={isPolishing}
                                          className="min-h-[38px] text-xs font-bold bg-purple-600 text-white px-3 py-1.5 rounded-lg hover:bg-purple-700 transition-colors"
                                       >
                                          {isPolishing ? <Loader2 size={12} className="animate-spin" /> : 'Refine'}
                                       </button>
                                    </div>

                                    {/* Action Chips */}
                                    <div className="w-full flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-200/80 mt-1">
                                       <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mr-1">Presets:</span>
                                       {[
                                          {
                                            label: "🔗 Smooth Chapter Seam",
                                            prompt: `Smooth the opening and closing transitions of this chapter so it flows seamlessly. ${
                                              currentChapterIndex > 0 && chapters[currentChapterIndex - 1]?.content
                                                ? `Preceding chapter ended with: "${chapters[currentChapterIndex - 1].content.slice(-500)}". `
                                                : ''
                                            }${
                                              currentChapterIndex < chapters.length - 1
                                                ? `Upcoming chapter is "${chapters[currentChapterIndex + 1]?.title}". `
                                                : ''
                                            }Ensure the opening picks up naturally without repetitive re-introductions and the ending bridges cleanly forward.`
                                          },
                                          ...(isNonfiction(writingStyle) ? [
                                            { label: 'Clarify the Explanation', prompt: 'Explain unfamiliar terms and sharpen cause-and-effect reasoning without adding unsupported claims.' },
                                            { label: 'Sharpen the Wit', prompt: 'Add restrained observational wit and useful analogies while preserving factual meaning and all citations.' },
                                            { label: 'Review Evidence Gaps', prompt: 'Compare factual claims with supplied evidence. Preserve supported citations and flag unsupported details with specific evidence-needed markers. Do not claim independent verification.' },
                                          ] : [
                                            { label: '✨ Sensory Details', prompt: 'Deepen sensory descriptions with sights, sounds, and physical atmosphere.' },
                                            { label: '💬 Character Dialogue', prompt: 'Add realistic character dialogue and natural subtext.' },
                                          ]),
                                          { label: "⚡ Accelerate Pacing", prompt: "Tighten sentences, remove slow exposition, and accelerate pacing." },
                                          { label: "🧹 Strip AI Clichés", prompt: "Strip AI clichés ('testament to', 'tapestry', 'delve') and strengthen active verbs." }
                                       ].map((chip, i) => (
                                          <button
                                             key={i}
                                             type="button"
                                             onClick={async () => {
                                                setPolishInstruction(chip.prompt);
                                                setIsPolishing(true);
                                                try {
                                                  const polished = await refineChapterText(editContent, chip.prompt, textModel, { style: writingStyle, sources, customInstruction });
                                                  setEditContent(polished);
                                                  setPolishInstruction('');
                                                } catch (e) {
                                                  showNotification("Polish failed.", 'error');
                                                } finally {
                                                  setIsPolishing(false);
                                                }
                                             }}
                                             disabled={isPolishing}
                                             className="text-[11px] bg-white border border-slate-200 text-slate-600 hover:text-purple-700 hover:border-purple-300 px-2.5 py-1 rounded-full transition-colors font-medium"
                                          >
                                             {chip.label}
                                          </button>
                                       ))}
                                    </div>
                                    <button onClick={saveEditing} className="w-full sm:w-auto min-h-[40px] flex items-center justify-center gap-1.5 text-xs font-bold bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
                                       <Save size={14} /> Save Chapter
                                    </button>
                                 </div>

                                 <textarea 
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    className="w-full h-[60vh] p-4 sm:p-6 bg-white border border-slate-200 rounded-xl shadow-inner font-serif text-base sm:text-lg leading-relaxed focus:ring-2 focus:ring-blue-100 focus:border-blue-300 outline-none resize-none"
                                 />
                              </div>
                           ) : (
                              <div className="prose prose-base sm:prose-lg prose-slate max-w-none font-serif leading-relaxed sm:leading-loose prose-headings:font-sans prose-headings:font-bold prose-p:text-slate-700">
                                 {/* Chapter Image/Sketch */}
                                 {onChapterUpdate && <div className="not-prose my-6">
                                   <ArtDirectionInput label="Chapter Illustration Prompt" value={currentChapter.illustrationPrompt || ''}
                                     disabled={isChapterImageGenerating || currentChapter.isGenerating}
                                     onChange={illustrationPrompt => onChapterUpdate({ ...currentChapter, illustrationPrompt }, { illustrationPrompt })}
                                     placeholder="e.g., A cutaway drawing of a steam engine, dark blue ink, clear lines, no labels." />
                                 </div>}
                                 {currentChapter.image ? (
                                    <div className="my-6 sm:my-8 rounded-xl overflow-hidden shadow-lg border border-slate-100">
                                       <img src={formatImageSrc(currentChapter.image)} alt={`Illustration for ${currentChapter.title}`} className="w-full h-auto" />
                                       <div className="flex flex-wrap items-center gap-3 px-4 py-2 bg-slate-50 font-sans text-xs">
                                         <span className="text-slate-600">{isNonfiction(writingStyle) ? 'AI conceptual illustration, not documentary evidence.' : 'AI vector illustration'}</span>
                                         <button type="button" onClick={handleGenerateChapterImage} disabled={isChapterImageGenerating || !onChapterUpdate}
                                           className="min-h-[44px] text-blue-700 font-bold disabled:opacity-50">
                                           {isChapterImageGenerating ? 'Generating…' : 'Regenerate Illustration'}
                                         </button>
                                         <button type="button" disabled={isChapterImageGenerating || !onChapterUpdate}
                                           onClick={() => onChapterUpdate?.({ ...currentChapter, image: undefined }, { image: undefined })}
                                           className="min-h-[44px] text-slate-600 disabled:opacity-50">Remove Illustration</button>
                                       </div>
                                    </div>
                                 ) : (
                                    <div className="flex justify-center my-6 group">
                                       <button 
                                          onClick={handleGenerateChapterImage}
                                          disabled={isChapterImageGenerating || !onChapterUpdate || currentChapter.isGenerating || !currentChapter.content.trim()}
                                          className="min-h-[40px] flex items-center gap-2 text-xs text-slate-500 hover:text-blue-600 border border-slate-200 hover:border-blue-200 bg-slate-50 hover:bg-blue-50 px-4 py-2 rounded-full transition-all"
                                       >
                                          {isChapterImageGenerating ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                                          {isChapterImageGenerating ? 'Generating Illustration…' : 'Generate Chapter Illustration'}
                                       </button>
                                    </div>
                                 )}

                                 <ReactMarkdown>{currentChapter.content}</ReactMarkdown>
                              </div>
                           )}

                           {!isEditing && (
                              <div className="mt-12 sm:mt-16 pt-6 sm:pt-8 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500">
                                 {/* Audio Player */}
                                 <div className="flex flex-wrap items-center justify-center gap-2.5 bg-slate-50 border border-slate-200/80 px-3.5 py-2 rounded-2xl w-full sm:w-auto order-1 sm:order-2">
                                     <Headphones size={16} className="text-blue-600 shrink-0" />
                                     {selectedVoice && onVoiceChange && (
                                         <select 
                                           value={selectedVoice} 
                                           onChange={(e) => onVoiceChange(e.target.value)}
                                           className="min-h-[38px] text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none font-medium text-slate-700"
                                         >
                                            <option value="Kore">Kore (Female)</option>
                                            <option value="Puck">Puck (Male)</option>
                                            <option value="Fenrir">Fenrir (Deep)</option>
                                            <option value="Aoede">Aoede (Soft)</option>
                                         </select>
                                     )}

                                     {/* Audiobook Speed Controls */}
                                     <select
                                       value={playbackSpeed}
                                       onChange={(e) => updatePlaybackSpeed(parseFloat(e.target.value))}
                                       className="min-h-[38px] text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 outline-none font-medium text-slate-700 cursor-pointer"
                                     >
                                        <option value={0.75}>0.75x</option>
                                        <option value={1.0}>1.0x</option>
                                        <option value={1.25}>1.25x</option>
                                        <option value={1.5}>1.5x</option>
                                        <option value={2.0}>2.0x</option>
                                     </select>
                                     <button 
                                        onClick={playChapterAudio}
                                        disabled={audioLoading}
                                        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-sm shrink-0 ${isPlaying ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
                                        title={isPlaying ? "Stop Reading Aloud" : "Read Chapter Aloud"}
                                     >
                                        {audioLoading ? (
                                           <Loader2 size={18} className="animate-spin" />
                                        ) : isPlaying ? (
                                           <Square size={16} fill="currentColor" />
                                        ) : (
                                           <Play size={18} fill="currentColor" className="ml-0.5" />
                                        )}
                                     </button>
                                 </div>

                                 <div className="flex items-center justify-between w-full sm:w-auto gap-4 order-2 sm:order-1">
                                   <button 
                                     disabled={currentChapterIndex === 0}
                                     onClick={() => setCurrentChapterIndex(prev => prev - 1)}
                                     className="min-h-[44px] px-4 rounded-xl border border-slate-200 sm:border-transparent flex items-center gap-1.5 font-semibold text-sm text-slate-600 hover:text-blue-600 disabled:opacity-30 transition-colors"
                                   >
                                      <ChevronLeft size={18} /> Previous
                                   </button>

                                   <button 
                                     disabled={currentChapterIndex === chapters.length - 1}
                                     onClick={() => setCurrentChapterIndex(prev => prev + 1)}
                                     className="sm:hidden min-h-[44px] px-4 rounded-xl border border-slate-200 flex items-center gap-1.5 font-semibold text-sm text-slate-600 hover:text-blue-600 disabled:opacity-30 transition-colors"
                                   >
                                      Next <ChevronRight size={18} />
                                   </button>
                                 </div>

                                 <button 
                                   disabled={currentChapterIndex === chapters.length - 1}
                                   onClick={() => setCurrentChapterIndex(prev => prev + 1)}
                                   className="hidden sm:flex min-h-[44px] px-3 items-center gap-1.5 font-semibold text-sm text-slate-600 hover:text-blue-600 disabled:opacity-30 transition-colors order-3"
                                 >
                                    Next <ChevronRight size={18} />
                                 </button>
                              </div>
                           )}
                        </>
                     )}
                  </div>
                )}
             </div>
        </div>

      </div>
    </>
  );
};
