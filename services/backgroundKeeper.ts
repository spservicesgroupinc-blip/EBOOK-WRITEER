// Mobile Background Keep-Alive & Lifecycle Manager for Ebook.AI
// Ensures manuscript generation continues running when the user locks their phone or switches apps.

const ACTIVE_JOB_KEY = 'ebookai_active_generation_job';

export interface ActiveGenerationJob {
  projectId: string;
  style: string;
  updatedAt: number;
}

// 1-second valid 8kHz mono 8-bit silent WAV file (base64)
const SILENT_WAV_DATA_URI =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

class BackgroundKeeperService {
  private wakeLock: WakeLockSentinel | null = null;
  private audioCtx: AudioContext | null = null;
  private silentAudioEl: HTMLAudioElement | null = null;
  private lockReleaseResolver: (() => void) | null = null;
  private worker: Worker | null = null;
  private isKeepingAlive = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.isKeepingAlive) {
          this.requestScreenWakeLock();
          this.ensureAudioRunning();
        }
      });
    }
  }

  /**
   * Non-throttled delay backed by an inline Web Worker so background tab timer throttling
   * does not stall inter-chapter pacing or retry backoff when the phone screen is off.
   */
  public unthrottledDelay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (typeof Worker === 'undefined') {
        setTimeout(resolve, ms);
        return;
      }
      try {
        const blob = new Blob(
          [
            `self.onmessage = function(e) { setTimeout(function() { self.postMessage('done'); }, e.data); };`,
          ],
          { type: 'application/javascript' }
        );
        const url = URL.createObjectURL(blob);
        const tempWorker = new Worker(url);
        const cleanup = () => {
          tempWorker.terminate();
          URL.revokeObjectURL(url);
          resolve();
        };
        tempWorker.onmessage = cleanup;
        tempWorker.onerror = cleanup;
        tempWorker.postMessage(ms);
      } catch {
        setTimeout(resolve, ms);
      }
    });
  }

  public saveActiveJob(projectId: string, style: string) {
    try {
      const job: ActiveGenerationJob = {
        projectId,
        style,
        updatedAt: Date.now(),
      };
      localStorage.setItem(ACTIVE_JOB_KEY, JSON.stringify(job));
    } catch {
      // Ignore storage errors
    }
  }

  public getActiveJob(): ActiveGenerationJob | null {
    try {
      const raw = localStorage.getItem(ACTIVE_JOB_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as ActiveGenerationJob;
    } catch {
      return null;
    }
  }

  public clearActiveJob() {
    try {
      localStorage.removeItem(ACTIVE_JOB_KEY);
    } catch {
      // Ignore storage errors
    }
  }

  public async startBackgroundSession(bookTitle: string, totalChapters: number) {
    this.isKeepingAlive = true;
    await this.requestScreenWakeLock();
    this.startWebLock();
    this.startSilentAudioKeepAlive(bookTitle, totalChapters);
    this.startHeartbeatWorker();
  }

  public updateProgress(bookTitle: string, currentChapterNum: number, totalChapters: number, chapterTitle: string) {
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `Writing Ch. ${currentChapterNum}/${totalChapters}: ${chapterTitle}`,
          artist: bookTitle,
          album: 'Ebook.AI Background Writer',
          artwork: [
            { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          ],
        });
        navigator.mediaSession.playbackState = 'playing';
      } catch {
        // Ignore MediaMetadata errors on unsupported browsers
      }
    }
  }

  public async stopBackgroundSession() {
    this.isKeepingAlive = false;
    await this.releaseScreenWakeLock();
    this.stopWebLock();
    this.stopSilentAudioKeepAlive();
    this.stopHeartbeatWorker();
  }

  private async requestScreenWakeLock() {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && !this.wakeLock) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      }
    } catch {
      // Ignore NotAllowedError when tab is already hidden
    }
  }

  private async releaseScreenWakeLock() {
    if (this.wakeLock) {
      try {
        await this.wakeLock.release();
      } catch {
        // Ignore
      }
      this.wakeLock = null;
    }
  }

  private startWebLock() {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && !this.lockReleaseResolver) {
      try {
        navigator.locks.request(
          'ebookai_background_generation_lock',
          { mode: 'exclusive' },
          () =>
            new Promise<void>((resolve) => {
              this.lockReleaseResolver = resolve;
            })
        );
      } catch {
        // Ignore if Web Locks API is unavailable
      }
    }
  }

  private stopWebLock() {
    if (this.lockReleaseResolver) {
      this.lockReleaseResolver();
      this.lockReleaseResolver = null;
    }
  }

  private startSilentAudioKeepAlive(bookTitle: string, totalChapters: number) {
    try {
      // 1. HTML5 <audio loop> element for mobile OS background media session persistence
      if (!this.silentAudioEl && typeof Audio !== 'undefined') {
        const audio = new Audio(SILENT_WAV_DATA_URI);
        audio.loop = true;
        audio.volume = 0.01;
        (audio as any).playsInline = true;
        this.silentAudioEl = audio;
      }
      if (this.silentAudioEl) {
        this.silentAudioEl.play().catch(() => {
          // Ignore if autoplay wasn't triggered by user gesture yet
        });
      }

      // 2. Ultra-quiet WebAudio oscillator
      const AudioContextClass =
        typeof window !== 'undefined'
          ? window.AudioContext || (window as any).webkitAudioContext
          : null;
      if (AudioContextClass && !this.audioCtx) {
        const ctx = new AudioContextClass();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.00001; // Inaudible
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        this.audioCtx = ctx;
      }
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }

      this.updateProgress(bookTitle, 1, totalChapters, 'Starting...');
    } catch {
      // Ignore audio errors
    }
  }

  private ensureAudioRunning() {
    if (!this.isKeepingAlive) return;
    if (this.silentAudioEl && this.silentAudioEl.paused) {
      this.silentAudioEl.play().catch(() => {});
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  private stopSilentAudioKeepAlive() {
    if (this.silentAudioEl) {
      try {
        this.silentAudioEl.pause();
        this.silentAudioEl.src = '';
      } catch {}
      this.silentAudioEl = null;
    }
    if (this.audioCtx) {
      try {
        this.audioCtx.close();
      } catch {}
      this.audioCtx = null;
    }
    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = 'none';
      } catch {}
    }
  }

  private startHeartbeatWorker() {
    if (this.worker || typeof Worker === 'undefined') return;
    try {
      const blob = new Blob(
        [
          `
          let timer = setInterval(() => {
            self.postMessage({ type: 'heartbeat', ts: Date.now() });
          }, 4000);
          self.onmessage = (e) => {
            if (e.data === 'stop') clearInterval(timer);
          };
        `,
        ],
        { type: 'application/javascript' }
      );
      const url = URL.createObjectURL(blob);
      this.worker = new Worker(url);
      this.worker.onmessage = () => {
        // Keep main thread event loop active
        if (this.isKeepingAlive) {
          this.ensureAudioRunning();
        }
      };
    } catch {
      // Ignore worker creation errors
    }
  }

  private stopHeartbeatWorker() {
    if (this.worker) {
      try {
        this.worker.postMessage('stop');
        this.worker.terminate();
      } catch {}
      this.worker = null;
    }
  }
}

export const BackgroundKeeper = new BackgroundKeeperService();
