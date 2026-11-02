import React, { useState } from 'react';
import { BookProject, User } from '../types';
import { Plus, Clock, Trash2, Download, BookCopy, Layers, Feather, Loader2, TrendingUp, X, ExternalLink, Globe, Lightbulb, Cloud, LogOut } from 'lucide-react';
import { researchBookTrends, TrendResult } from '../services/gemini';
import { CloudService } from '../services/cloud';
import { PWAInstallButton } from './PWAInstallButton';
import ReactMarkdown from 'react-markdown';

interface DashboardProps {
  projects: BookProject[];
  user?: User;
  onCreateProject: () => void;
  onSelectProject: (project: BookProject) => void;
  onDeleteProject: (id: string, e: React.MouseEvent) => void;
  onCreateSequel?: (project: BookProject) => void;
  onSyncProjects?: (projects: BookProject[]) => void;
  onLogout?: () => void;
  generatingProjectId?: string | null;
}

export const Dashboard: React.FC<DashboardProps> = ({ 
  projects, 
  user,
  onCreateProject, 
  onSelectProject,
  onDeleteProject,
  onCreateSequel,
  onSyncProjects,
  onLogout,
  generatingProjectId
}) => {
  const [showTrends, setShowTrends] = useState(false);
  const [isResearching, setIsResearching] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [trendData, setTrendData] = useState<TrendResult | null>(null);

  const formatDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const handleBackup = (e: React.MouseEvent, project: BookProject) => {
    e.stopPropagation();
    const element = document.createElement("a");
    const file = new Blob([JSON.stringify(project, null, 2)], {type: 'application/json'});
    element.href = URL.createObjectURL(file);
    element.download = `backup_${project.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleCloudSync = async () => {
    if (!user || !onSyncProjects) return;
    setIsSyncing(true);
    setSyncStatus(null);
    try {
      for (const p of projects) {
        await CloudService.syncUp(user, p);
      }
      const cloudProjects = await CloudService.syncDown(user);
      onSyncProjects(cloudProjects);
      setSyncStatus(`Synced ${cloudProjects.length} projects`);
      setTimeout(() => setSyncStatus(null), 3500);
    } catch (e: any) {
      setSyncStatus(`Sync failed: ${e.message}`);
      setTimeout(() => setSyncStatus(null), 4000);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleResearch = async () => {
    setIsResearching(true);
    setTrendData(null);
    try {
      const data = await researchBookTrends();
      setTrendData(data);
    } catch (e) {
      console.error(e);
      setTrendData({ content: "Unable to retrieve trends at this time. Please try again later.", sources: [] });
    } finally {
      setIsResearching(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900 pb-28 sm:pb-16">
      {/* Mobile Install Banner */}
      <PWAInstallButton variant="banner" />

      {/* Header */}
      <header className="bg-blue-950 border-b border-blue-900 text-white shadow-md sticky top-0 z-30 pt-safe">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-12 h-16 md:h-20 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/icon.svg"
              alt="Ebook.AI Logo"
              className="w-10 h-10 rounded-xl shadow-md border border-white/15 shrink-0"
            />
            <div className="min-w-0">
              <h1 className="font-serif text-lg sm:text-2xl font-bold tracking-tight truncate">
                Ebook<span className="text-sky-400">.AI</span>
              </h1>
              {user && <p className="text-[10px] text-blue-200 opacity-80 uppercase tracking-widest truncate">{user.username}</p>}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton variant="header" />

            {user && (
              <>
                <button 
                  onClick={handleCloudSync}
                  disabled={isSyncing}
                  className="min-h-[44px] bg-blue-900/50 hover:bg-blue-800 text-blue-100 border border-blue-800 px-3 py-2 rounded-xl font-medium text-xs flex items-center gap-1.5 transition-all"
                  title="Sync to Drive"
                >
                  <Cloud size={16} className={isSyncing ? 'animate-bounce' : ''} />
                  <span className="hidden sm:inline">{isSyncing ? 'Syncing...' : 'Sync'}</span>
                </button>
                <button 
                  onClick={onLogout}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center bg-blue-900/50 hover:bg-red-900/50 text-blue-100 hover:text-red-100 border border-blue-800 hover:border-red-800 rounded-xl transition-all"
                  title="Logout"
                >
                  <LogOut size={16} />
                </button>
              </>
            )}

            <button 
              onClick={() => setShowTrends(true)}
              className="hidden sm:flex min-h-[44px] bg-blue-900/50 hover:bg-blue-800 text-blue-100 border border-blue-800 px-4 py-2 rounded-xl font-medium text-sm items-center gap-2 transition-all"
            >
              <TrendingUp size={16} />
              <span className="hidden md:inline">Market Trends</span>
            </button>
            <button 
              onClick={onCreateProject}
              className="hidden sm:flex min-h-[44px] bg-blue-600 hover:bg-blue-500 text-white px-5 py-2 rounded-xl font-medium text-sm items-center gap-2 transition-all shadow-lg shadow-blue-900/20"
            >
              <Plus size={18} />
              <span>New Manuscript</span>
            </button>
          </div>
        </div>
        {syncStatus && (
          <div className="bg-blue-900 text-blue-100 text-xs font-medium text-center py-1.5 px-4">
            {syncStatus}
          </div>
        )}
      </header>

      {/* Projects List */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 md:px-12 py-6 sm:py-10">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-slate-900">My Library</h2>
            <p className="text-xs text-slate-500 sm:hidden mt-0.5">Tap any manuscript to open or record notes</p>
          </div>
          <div className="text-xs sm:text-sm text-slate-500 font-semibold bg-white px-3 py-1 rounded-full border border-slate-200">
            {projects.length} {projects.length === 1 ? 'Book' : 'Books'}
          </div>
        </div>
        
        {projects.length === 0 ? (
          <div className="text-center py-16 sm:py-24 px-6 bg-white rounded-2xl border-2 border-dashed border-slate-200 shadow-sm">
            <div className="w-16 h-16 sm:w-20 sm:h-20 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-5 text-blue-500">
              <Feather size={30} strokeWidth={1.5} />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">No manuscripts yet</h3>
            <p className="text-sm sm:text-base text-slate-500 max-w-md mx-auto mb-6 font-light leading-relaxed">
              Begin your journey by creating a new project. Transform your spoken stories and notes into a written book.
            </p>
            <button 
              onClick={onCreateProject}
              className="min-h-[48px] bg-blue-600 hover:bg-blue-500 text-white font-bold px-6 py-3 rounded-xl shadow-md transition-all inline-flex items-center gap-2"
            >
              <Plus size={18} />
              Start First Manuscript
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {projects.map(project => {
              const isGenerating = generatingProjectId === project.id;
              
              return (
              <div 
                key={project.id}
                onClick={() => onSelectProject(project)}
                className={`group bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl hover:shadow-blue-900/5 hover:border-blue-200 active:scale-[0.99] transition-all cursor-pointer flex flex-col min-h-[220px] sm:h-72 relative overflow-hidden ${isGenerating ? 'ring-2 ring-blue-500 ring-offset-2' : ''}`}
              >
                <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-blue-600 to-blue-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"></div>
                
                <div className="p-5 sm:p-8 flex-1 flex flex-col relative z-10">
                   {/* Decorative background letter */}
                   <span className="font-serif text-7xl sm:text-8xl text-slate-50 font-bold absolute -bottom-4 -right-4 select-none group-hover:text-blue-50 transition-colors duration-300 -z-10">
                      {project.title.charAt(0).toUpperCase()}
                   </span>

                  <div className="relative">
                    <div className="flex items-center justify-between mb-2.5">
                      <div className="flex items-center gap-2 text-xs text-blue-600 font-bold uppercase tracking-wider">
                        <div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-blue-500 animate-pulse' : 'bg-blue-500'}`}></div>
                        {isGenerating ? 'Writing Now...' : project.outline ? 'In Progress' : 'Drafting'}
                      </div>
                      {project.seriesId && (
                         <div className="flex items-center gap-1 text-[10px] text-purple-600 font-bold uppercase tracking-wider bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">
                            <Layers size={10} />
                            {project.seriesIndex ? `Vol. ${project.seriesIndex}` : 'Series'}
                         </div>
                      )}
                    </div>
                    <h3 className="font-serif font-bold text-lg sm:text-xl text-slate-900 mb-2.5 line-clamp-2 leading-tight group-hover:text-blue-700 transition-colors">
                      {project.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
                      {isGenerating ? (
                        <div className="text-blue-600 flex items-center gap-1">
                           <Loader2 size={12} className="animate-spin" /> Auto-Saving...
                        </div>
                      ) : (
                        <>
                          <Clock size={12} />
                          Edited {formatDate(project.lastModified)}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50/80 border-t border-slate-100 px-4 sm:px-6 py-2.5 flex items-center justify-between backdrop-blur-sm relative z-20">
                   <div className="flex gap-2">
                      <span className="text-xs font-semibold px-2.5 py-1 bg-white border border-slate-200 rounded-lg text-slate-600 shadow-sm">
                        {project.outline ? `${project.outline.chapters.length} Chapters` : 'Source Gathering'}
                      </span>
                   </div>
                   
                   <div className="flex items-center gap-0.5">
                      {onCreateSequel && project.outline && (
                        <button 
                          onClick={(e) => { e.stopPropagation(); onCreateSequel(project); }}
                          className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-xl transition-colors relative z-30"
                          title="Create Sequel / Next in Series"
                        >
                          <BookCopy size={17} />
                        </button>
                      )}
                      <button 
                        onClick={(e) => handleBackup(e, project)}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-colors relative z-30"
                        title="Backup JSON"
                      >
                        <Download size={17} />
                      </button>
                      <button 
                        onClick={(e) => onDeleteProject(project.id, e)}
                        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors relative z-30"
                        title="Delete"
                      >
                        <Trash2 size={17} />
                      </button>
                   </div>
                </div>
              </div>
            )})}
          </div>
        )}
      </main>

      {/* Smartphone Fixed Bottom Action Bar (Thumb Zone) */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2.5 pb-safe flex items-center gap-2.5 shadow-lg">
        <button
          onClick={() => setShowTrends(true)}
          className="min-h-[48px] px-4 rounded-xl border border-slate-200 bg-slate-50 text-slate-700 font-semibold text-xs flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform shrink-0"
        >
          <TrendingUp size={16} className="text-blue-600" />
          <span>Trends</span>
        </button>
        <button
          onClick={onCreateProject}
          className="flex-1 min-h-[48px] rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 active:scale-[0.98] transition-transform"
        >
          <Plus size={18} />
          <span>New Manuscript</span>
        </button>
      </div>

      {/* Market Trends Modal (Bottom Sheet on Mobile) */}
      {showTrends && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white w-full max-w-4xl h-[90dvh] sm:h-[80vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
             
             {/* Modal Header */}
             <div className="bg-blue-950 text-white p-5 sm:p-6 flex justify-between items-start shrink-0">
                <div>
                   <h2 className="text-xl sm:text-2xl font-serif font-bold flex items-center gap-2">
                     <Globe size={22} className="text-blue-300 shrink-0" />
                     E-Book Market Research
                   </h2>
                   <p className="text-blue-200 text-xs sm:text-sm mt-1">Deep analysis of current sales trends and popular genres.</p>
                </div>
                <button 
                  onClick={() => setShowTrends(false)}
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center text-blue-200 hover:text-white hover:bg-white/10 rounded-xl transition-colors"
                >
                  <X size={24} />
                </button>
             </div>

             {/* Modal Body */}
             <div className="flex-1 overflow-y-auto p-5 sm:p-8 bg-slate-50 pb-safe">
                {!trendData && !isResearching && (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-6 py-8">
                     <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                        <TrendingUp size={40} />
                     </div>
                     <div className="max-w-md">
                       <h3 className="text-xl font-bold text-slate-900 mb-2">Discover Your Next Bestseller</h3>
                       <p className="text-sm sm:text-base text-slate-500 mb-8">
                         Our AI will analyze current gross sales, trending tropes, and rising niches to help you find a profitable story idea.
                       </p>
                       <button 
                         onClick={handleResearch}
                         className="min-h-[48px] bg-blue-600 hover:bg-blue-500 text-white px-6 sm:px-8 py-3.5 rounded-xl font-bold text-base sm:text-lg shadow-xl shadow-blue-600/20 active:scale-[0.98] transition-all flex items-center gap-3 mx-auto"
                       >
                         <Lightbulb size={20} />
                         Analyze Market Trends
                       </button>
                     </div>
                  </div>
                )}

                {isResearching && (
                  <div className="flex flex-col items-center justify-center h-full text-center space-y-6 animate-pulse py-12">
                     <Loader2 size={48} className="animate-spin text-blue-600" />
                     <h3 className="text-lg sm:text-xl font-bold text-slate-700">Analyzing Global Sales Data...</h3>
                  </div>
                )}

                {trendData && (
                  <div className="animate-in fade-in slide-in-from-bottom-4">
                    <div className="prose prose-sm sm:prose-base prose-slate max-w-none prose-headings:font-serif prose-headings:text-blue-900 prose-a:text-blue-600">
                      <ReactMarkdown>{trendData.content}</ReactMarkdown>
                    </div>
                    
                    {trendData.sources.length > 0 && (
                      <div className="mt-8 pt-6 border-t border-slate-200">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Sources &amp; References</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {trendData.sources.map((source, idx) => (
                            <a 
                              key={idx} 
                              href={source.uri} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl text-sm text-slate-600 hover:text-blue-600 hover:border-blue-300 transition-all group"
                            >
                              <ExternalLink size={14} className="shrink-0 group-hover:text-blue-500" />
                              <span className="truncate">{source.title}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-8 flex justify-center">
                       <button 
                         onClick={handleResearch}
                         className="min-h-[44px] text-blue-600 hover:text-blue-800 font-bold text-sm flex items-center gap-2 bg-blue-50 hover:bg-blue-100 px-5 py-2.5 rounded-xl transition-colors"
                       >
                         <TrendingUp size={14} /> Refresh Analysis
                       </button>
                    </div>
                  </div>
                )}
             </div>
          </div>
        </div>
      )}
    </div>
  );
};

