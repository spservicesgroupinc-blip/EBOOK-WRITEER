import { useState, useEffect, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

// Keep a singleton reference in case the event fires before a component mounts
let deferredPromptGlobal: BeforeInstallPromptEvent | null = null;
const promptListeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPromptGlobal = e as BeforeInstallPromptEvent;
    promptListeners.forEach((cb) => cb());
  });
}

export function usePWAInstall() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(deferredPromptGlobal);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    setIsInstalled(checkStandalone);

    const ua = window.navigator.userAgent.toLowerCase();
    const ios =
      /iphone|ipad|ipod/.test(ua) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsIOS(ios);
    setIsMobile(ios || /android|mobile/.test(ua) || window.innerWidth < 768);

    const syncPrompt = () => {
      setInstallPrompt(deferredPromptGlobal);
    };
    promptListeners.add(syncPrompt);

    const handleAppInstalled = () => {
      setIsInstalled(true);
      deferredPromptGlobal = null;
      setInstallPrompt(null);
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      promptListeners.delete(syncPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      deferredPromptGlobal = null;
      setInstallPrompt(null);
      return true;
    }
    return false;
  }, [installPrompt]);

  return {
    isInstallable: !!installPrompt && !isInstalled,
    isInstalled,
    isIOS: isIOS && !isInstalled,
    isMobile,
    promptInstall,
  };
}
