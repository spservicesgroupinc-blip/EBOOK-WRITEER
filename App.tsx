
import React, { useState, useEffect, useRef } from 'react';
import { BookProject, AppView, Source, SourceType, WritingStyle, ChapterContent, User } from './types';
import { Dashboard } from './components/Dashboard';
import { ProjectEditor } from './components/ProjectEditor';
import { AuthScreen } from './components/AuthScreen';
import { writeChapter } from './services/gemini';
import { PricingService } from './services/pricing';
import { StorageService } from './services/storage';
import { CloudService, BACKEND_URL } from './services/cloud';
import { BackgroundKeeper } from './services/backgroundKeeper';
import { Loader2 } from 'lucide-react';
import { CostTracker } from './components/CostTracker';
import { OfflineIndicator } from './components/OfflineIndicator';

const App: React.FC = () => {
  const [view, setView] = useState<AppView>(AppView.AUTH);
  const [projects, setProjects] = useState<BookProject[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [user, setUser] = useState<User | undefined>(undefined);
  
  // Background Generation State
  const [generatingProjectId, setGeneratingProjectId] = useState<string | null>(null);
  const isGeneratorRunningRef = useRef<boolean>(false);
  const projectsRef = useRef<BookProject[]>([]);
  const userRef = useRef<User | undefined>(undefined);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Sync State
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Initial Load from Storage
  useEffect(() => {
    const loadData = async () => {
      try {
        const savedUser = localStorage.getItem('ebookai_user');
        if (savedUser) {
          const parsedUser = JSON.parse(savedUser);
          if (BACKEND_URL) {
            parsedUser.backendUrl = BACKEND_URL;
          }
          setUser(parsedUser);
          userRef.current = parsedUser;
        }

        const loadedProjects = await StorageService.getAllProjects();
        setProjects(loadedProjects);
        projectsRef.current = loadedProjects;
        
        const lastActiveId = await StorageService.getActiveProjectId();
        if (lastActiveId && loadedProjects.find(p => p.id === lastActiveId)) {
          setActiveProjectId(lastActiveId);
          setView(AppView.EDITOR);
          window.history.replaceState({ view: AppView.EDITOR, projectId: lastActiveId }, '');
        } else if (savedUser) {
           setView(AppView.DASHBOARD);
        }
      } catch (e) {
        console.error("Failed to load data", e);
      } finally {
        setIsLoaded(true);
      }
    };
    loadData();
  }, []);

  // Save changes to Local Storage
  useEffect(() => {
    if (!isLoaded) return; 

    const saveData = async () => {
      try {
        await StorageService.saveAllProjects(projects);
        await StorageService.saveActiveProjectId(activeProjectId);
      } catch (e: any) {
        if (e.name === 'QuotaExceededError') {
           alert("⚠️ Disk Full! Your device storage is full.");
        } else {
           console.error("Failed to save project", e);
        }
      }
    };

    const timeout = setTimeout(saveData, 500);
    return () => clearTimeout(timeout);
  }, [projects, activeProjectId, isLoaded]);

  // Auto-save active project to Cloud (Debounced)
  useEffect(() => {
    if (!user || !activeProjectId) return;
    
    const projectToSave = projects.find(p => p.id === activeProjectId);
    if (!projectToSave) return;

    const timeout = setTimeout(async () => {
        try {
            await CloudService.syncUp(user, projectToSave);
            console.log(`Cloud auto-save complete for ${projectToSave.title}`);
        } catch (e) {
            console.error("Cloud auto-save failed", e);
        }
    }, 5000); 

    return () => clearTimeout(timeout);
  }, [projects, activeProjectId, user]);

  // Handle Browser Back Button
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (!user) {
        setView(AppView.AUTH);
        return;
      }
      if (event.state && event.state.view === AppView.EDITOR) {
        setActiveProjectId(event.state.projectId);
        setView(AppView.EDITOR);
      } else {
        setActiveProjectId(null);
        setView(AppView.DASHBOARD);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user]);

  // --- Background Generator & Auto-Resume Logic ---

  const startBookGeneration = async (projectId: string, style: WritingStyle = 'standard') => {
    if (isGeneratorRunningRef.current) return;

    const project = projectsRef.current.find(p => p.id === projectId);
    if (!project || !project.outline) return;

    isGeneratorRunningRef.current = true;
    setGeneratingProjectId(projectId);
    BackgroundKeeper.saveActiveJob(projectId, style);
    await BackgroundKeeper.startBackgroundSession(project.title, project.outline.chapters.length);

    const currentChapters: ChapterContent[] = project.outline.chapters.map(outlineChap => {
      const existing = project.chapters.find(c => c.chapterNumber === outlineChap.chapterNumber);
      if (
        existing &&
        existing.content &&
        existing.content.trim() !== '' &&
        !existing.content.startsWith('Generation failed.') &&
        !existing.content.startsWith('Stopped due to API error.') &&
        !existing.isGenerating
      ) {
        return { ...existing, title: outlineChap.title };
      }
      return {
        ...existing,
        chapterNumber: outlineChap.chapterNumber,
        title: outlineChap.title,
        content: '',
        isGenerating: true
      };
    });

    const initialUpdatedProject: BookProject = {
      ...(projectsRef.current.find(p => p.id === projectId) || project),
      chapters: currentChapters,
      lastModified: Date.now()
    };

    projectsRef.current = projectsRef.current.map(p => p.id === projectId ? initialUpdatedProject : p);
    setProjects(projectsRef.current);
    await StorageService.saveAllProjects(projectsRef.current).catch(() => {});

    let hasFatalError = false;
    let pausedForBackgroundReconnect = false;
    const totalChapters = project.outline.chapters.length;

    for (let chapIdx = 0; chapIdx < project.outline.chapters.length; chapIdx++) {
      const chapOutline = project.outline.chapters[chapIdx];
      const chapterToGen = currentChapters.find(c => c.chapterNumber === chapOutline.chapterNumber);
      
      if (chapterToGen && chapterToGen.content && !chapterToGen.isGenerating) {
        continue;
      }
      
      if (hasFatalError || pausedForBackgroundReconnect) break;

      BackgroundKeeper.saveActiveJob(projectId, style);
      BackgroundKeeper.updateProgress(
        project.title,
        chapIdx + 1,
        totalChapters,
        chapOutline.title
      );

      try {
        // Build sliding context window:
        // 1. Previous chapter ending scene & Next chapter summary
        const currentIdxInOutline = project.outline.chapters.findIndex(c => c.chapterNumber === chapOutline.chapterNumber);
        const prevChapterIndex = currentIdxInOutline - 1;
        const nextChapterIndex = currentIdxInOutline + 1;
        let previousChapterEnding = "";
        if (prevChapterIndex >= 0) {
          const prevChapNum = project.outline.chapters[prevChapterIndex].chapterNumber;
          const prevCompleted = currentChapters.find(c => c.chapterNumber === prevChapNum);
          if (prevCompleted && prevCompleted.content) {
             previousChapterEnding = prevCompleted.content.slice(-1200);
          }
        }

        let nextChapterSummary = "";
        if (nextChapterIndex >= 0 && nextChapterIndex < project.outline.chapters.length) {
          const nextChap = project.outline.chapters[nextChapterIndex];
          nextChapterSummary = `Chapter ${nextChap.chapterNumber} ("${nextChap.title}"): ${nextChap.summary}`;
        }

        // 2. Story So Far recap (Summaries of preceding chapters)
        const precedingSummaries = project.outline.chapters
          .filter(c => c.chapterNumber < chapOutline.chapterNumber)
          .map(c => `Chapter ${c.chapterNumber === 0 ? 'Intro' : c.chapterNumber} ("${c.title}"): ${c.summary}`)
          .join('\n');

        const latestProject = projectsRef.current.find(p => p.id === projectId) || project;

        const content = await writeChapter(chapOutline, latestProject.outline!, latestProject.sources, {
          style: latestProject.settings?.writingStyle || style,
          customInstruction: latestProject.customInstruction,
          pov: latestProject.settings?.pov || 'third_limited',
          tense: latestProject.settings?.tense || 'past',
          targetDepth: latestProject.settings?.targetDepth || 'standard',
          twoPassPolish: Boolean(latestProject.settings?.twoPassPolish),
          previousChapterEnding: previousChapterEnding,
          nextChapterSummary: nextChapterSummary,
          storySoFarRecap: precedingSummaries,
          loreVault: latestProject.outline!.loreVault || latestProject.outline!.loreBible,
          model: latestProject.settings?.textModel || PricingService.getSelectedTextModel(),
        });
        
        // Keep art prompts, illustrations, and edits made while this request ran.
        const liveChapters = projectsRef.current.find(p => p.id === projectId)?.chapters || [];
        for (let chapterIndex = 0; chapterIndex < currentChapters.length; chapterIndex++) {
          const live = liveChapters.find(c => c.chapterNumber === currentChapters[chapterIndex].chapterNumber);
          if (live) currentChapters[chapterIndex] = { ...currentChapters[chapterIndex], ...live };
        }
        const idx = currentChapters.findIndex(c => c.chapterNumber === chapOutline.chapterNumber);
        if (idx !== -1) {
          currentChapters[idx] = { ...currentChapters[idx], content, isGenerating: false };
        }

        // Immediately persist completed chapter to React state, IndexedDB, and Cloud
        // so progress is never lost even if the phone is locked or closed
        const updatedSnapshot: BookProject = {
          ...(projectsRef.current.find(p => p.id === projectId) || latestProject),
          chapters: [...currentChapters],
          lastModified: Date.now()
        };

        projectsRef.current = projectsRef.current.map(p => p.id === projectId ? updatedSnapshot : p);
        setProjects([...projectsRef.current]);

        await StorageService.saveAllProjects(projectsRef.current).catch(() => {});
        if (userRef.current) {
          CloudService.syncUp(userRef.current, updatedSnapshot).catch(() => {});
        }

        // Non-throttled Web Worker delay between chapters
        await BackgroundKeeper.unthrottledDelay(800);

      } catch (e: any) {
         console.error(`Error generating chapter ${chapOutline.chapterNumber}`, e);
         const isFatal = e.message?.includes('leaked') || e.message?.includes('PERMISSION_DENIED') || e.status === 403;
         const isHiddenOrOffline =
           (typeof document !== 'undefined' && document.visibilityState === 'hidden') ||
           (typeof navigator !== 'undefined' && navigator.onLine === false);

         if (isFatal) {
             hasFatalError = true;
             BackgroundKeeper.clearActiveJob();
         } else if (isHiddenOrOffline) {
             // Phone OS suspended network while screen was locked; keep chapter in isGenerating: true
             // and leave active job in localStorage so it auto-resumes when phone wakes or reconnects!
             pausedForBackgroundReconnect = true;
             break;
         }

         const failedSnapshot: BookProject = {
           ...(projectsRef.current.find(p => p.id === projectId) || project),
           chapters: currentChapters.map(c =>
             c.chapterNumber === chapOutline.chapterNumber
               ? { ...c, isGenerating: false, content: isFatal ? "Stopped due to API error." : "Generation failed. Please retry." }
               : c
           ),
           lastModified: Date.now()
         };
         projectsRef.current = projectsRef.current.map(p => p.id === projectId ? failedSnapshot : p);
         setProjects([...projectsRef.current]);
         await StorageService.saveAllProjects(projectsRef.current).catch(() => {});
      }
    }

    const allDone = currentChapters.every(c => !c.isGenerating && Boolean(c.content));
    if (allDone || hasFatalError) {
      BackgroundKeeper.clearActiveJob();
      await BackgroundKeeper.stopBackgroundSession();
      setGeneratingProjectId(null);
    }

    isGeneratorRunningRef.current = false;
  };

  // Auto-Resume unfinished book generation when app loads, phone wakes up, or network reconnects
  useEffect(() => {
    if (!isLoaded) return;

    const checkAndResumeGeneration = () => {
      if (isGeneratorRunningRef.current) return;

      const activeJob = BackgroundKeeper.getActiveJob();
      if (activeJob) {
        const target = projectsRef.current.find(p => p.id === activeJob.projectId);
        if (target && target.outline) {
          const hasRemaining =
            target.chapters.length < target.outline.chapters.length ||
            target.chapters.some(c => c.isGenerating || !c.content);
          if (hasRemaining) {
            startBookGeneration(activeJob.projectId, (activeJob.style as WritingStyle) || 'standard');
            return;
          } else {
            BackgroundKeeper.clearActiveJob();
          }
        }
      }

      // Also check if any project has chapters still marked isGenerating: true
      const unfinishedProject = projectsRef.current.find(
        p => p.outline && p.chapters.some(c => c.isGenerating)
      );
      if (unfinishedProject) {
        startBookGeneration(unfinishedProject.id, 'standard');
      }
    };

    checkAndResumeGeneration();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        checkAndResumeGeneration();
      }
    };

    window.addEventListener('focus', checkAndResumeGeneration);
    window.addEventListener('online', checkAndResumeGeneration);
    window.addEventListener('pageshow', checkAndResumeGeneration);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('focus', checkAndResumeGeneration);
      window.removeEventListener('online', checkAndResumeGeneration);
      window.removeEventListener('pageshow', checkAndResumeGeneration);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // --- End Generator Logic ---

  const handleCreateProject = () => {
    const newProject: BookProject = {
      id: crypto.randomUUID(),
      title: 'Untitled Manuscript',
      lastModified: Date.now(),
      sources: [],
      outline: null,
      chapters: [],
      currentStep: 0,
    };
    
    setProjects(prev => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setView(AppView.EDITOR);
    window.history.pushState({ view: AppView.EDITOR, projectId: newProject.id }, '');
  };

  const handleCreateSequel = (originalProject: BookProject) => {
     const seriesId = originalProject.seriesId || crypto.randomUUID();
     const nextIndex = (originalProject.seriesIndex || 1) + 1;

     if (!originalProject.seriesId) {
        const updatedOriginal = { ...originalProject, seriesId, seriesIndex: 1 };
        handleUpdateProject(updatedOriginal);
     }

     const contextContent = `PREVIOUS BOOK CONTEXT:
Title: ${originalProject.title}
Description: ${originalProject.outline?.description || 'No description available.'}

CHAPTER SUMMARIES:
${originalProject.outline?.chapters.map(c => `Chapter ${c.chapterNumber}: ${c.title}\n${c.summary}`).join('\n\n') || 'No chapters available.'}
`;

    const contextSource: Source = {
      id: crypto.randomUUID(),
      type: SourceType.TEXT,
      name: `Context: ${originalProject.title}`,
      content: contextContent,
      isProcessing: false
    };

    const newProject: BookProject = {
      id: crypto.randomUUID(),
      title: `Sequel to ${originalProject.title}`,
      lastModified: Date.now(),
      sources: [contextSource],
      outline: null,
      chapters: [],
      currentStep: 0,
      seriesId: seriesId,
      seriesIndex: nextIndex
    };

    setProjects(prev => [newProject, ...prev]);
    setActiveProjectId(newProject.id);
    setView(AppView.EDITOR);
    window.history.pushState({ view: AppView.EDITOR, projectId: newProject.id }, '');
  };

  const handleUpdateProject = (updatedProject: BookProject) => {
    // A child's generation effect can run before this component's effects.
    // Publish the updated snapshot synchronously so it sees the saved style and step.
    projectsRef.current = projectsRef.current.map(p => p.id === updatedProject.id ? updatedProject : p);
    setProjects(projectsRef.current);
  };

  const handleDeleteProject = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm('Are you sure you want to delete this project? This action cannot be undone.')) {
      setProjects(prev => prev.filter(p => p.id !== id));
      if (activeProjectId === id) {
        setActiveProjectId(null);
        setView(AppView.DASHBOARD);
        window.history.replaceState({ view: AppView.DASHBOARD }, '');
      }
    }
  };

  const handleSelectProject = (project: BookProject) => {
    setActiveProjectId(project.id);
    setView(AppView.EDITOR);
    window.history.pushState({ view: AppView.EDITOR, projectId: project.id }, '');
  };

  const handleBackToDashboard = () => {
    setActiveProjectId(null);
    setView(AppView.DASHBOARD);
    window.history.pushState({ view: AppView.DASHBOARD }, '');
  };

  const handleLogin = async (user: User) => {
    setIsLoggingIn(true);
    setUser(user);
    localStorage.setItem('ebookai_user', JSON.stringify(user));

    try {
        // Automatically sync down from cloud to get previous books
        const cloudProjects = await CloudService.syncDown(user);
        
        // Merge Strategy: Combine cloud and local. If ID exists in both, prefer the one with newer timestamp.
        setProjects(prev => {
            const merged = [...prev];
            cloudProjects.forEach(cp => {
                const existingIdx = merged.findIndex(p => p.id === cp.id);
                if (existingIdx !== -1) {
                    // Update if cloud version is newer
                    if (cp.lastModified > merged[existingIdx].lastModified) {
                        merged[existingIdx] = cp;
                    }
                } else {
                    // Add new from cloud
                    merged.push(cp);
                }
            });
            // Persist merged state to local storage immediately
            StorageService.saveAllProjects(merged);
            return merged;
        });

    } catch(e) {
        console.error("Auto-sync on login failed", e);
        // We continue to dashboard even if sync fails, so user isn't stuck
    } finally {
        setIsLoggingIn(false);
        setView(AppView.DASHBOARD);
    }
  };

  const handleLogout = () => {
    setUser(undefined);
    localStorage.removeItem('ebookai_user');
    setView(AppView.AUTH);
  };

  const handleSyncProjects = (cloudProjects: BookProject[]) => {
      const merged = [...projects];
      cloudProjects.forEach(cp => {
          const idx = merged.findIndex(p => p.id === cp.id);
          if (idx !== -1) {
              if (cp.lastModified > merged[idx].lastModified) {
                  merged[idx] = cp;
              }
          } else {
              merged.push(cp);
          }
      });
      setProjects(merged);
  };

  const activeProject = projects.find(p => p.id === activeProjectId);

  // Loading State for Data
  if (!isLoaded) {
     return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
           <div className="animate-pulse flex flex-col items-center">
              <img src="/icon.svg" alt="Ebook.AI" className="w-12 h-12 rounded-2xl mb-4 shadow-md" />
              <div className="text-slate-400 font-medium">Initializing Ebook.AI...</div>
           </div>
        </div>
     );
  }
  
  // Login loading state
  if (isLoggingIn) {
     return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
           <div className="flex flex-col items-center">
              <Loader2 className="w-12 h-12 text-blue-600 animate-spin mb-4" />
              <div className="text-slate-800 font-bold text-lg">Syncing Library...</div>
              <p className="text-slate-500 text-sm mt-1">Retrieving your books from the cloud.</p>
           </div>
        </div>
     );
  }

  return (
    <>
      <OfflineIndicator />
      <CostTracker />
      {/* Auth Screen (Priority 2) */}
      {(!user || view === AppView.AUTH) ? (
        <AuthScreen onLogin={handleLogin} />
      ) : (
        /* Main App */
        (view === AppView.EDITOR && activeProject) ? (
          <ProjectEditor 
            project={activeProject} 
            onUpdateProject={handleUpdateProject}
            onBack={handleBackToDashboard}
            onStartGeneration={(style) => startBookGeneration(activeProject.id, style)}
            isGeneratingGlobal={generatingProjectId === activeProject.id}
            user={user}
          />
        ) : (
          <Dashboard 
            projects={projects} 
            user={user}
            onCreateProject={handleCreateProject}
            onSelectProject={handleSelectProject}
            onDeleteProject={handleDeleteProject}
            onCreateSequel={handleCreateSequel}
            onSyncProjects={handleSyncProjects}
            onLogout={handleLogout}
            generatingProjectId={generatingProjectId}
          />
        )
      )}
    </>
  );
};

export default App;
