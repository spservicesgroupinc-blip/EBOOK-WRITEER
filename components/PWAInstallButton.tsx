import React, { useState } from 'react';
import { Download, Share, PlusSquare, X, Smartphone, CheckCircle2, MoreVertical } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'header' | 'card' | 'banner';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'header' }) => {
  const { isInstallable, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showModal, setShowModal] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('ebookai_pwa_banner_dismissed') === '1';
    } catch {
      return false;
    }
  });

  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    if (isInstallable) {
      const accepted = await promptInstall();
      if (!accepted) {
        setShowModal(true);
      }
    } else {
      setShowModal(true);
    }
  };

  const dismissBanner = () => {
    setBannerDismissed(true);
    try {
      sessionStorage.setItem('ebookai_pwa_banner_dismissed', '1');
    } catch {}
  };

  if (variant === 'banner' && bannerDismissed) {
    return null;
  }

  return (
    <>
      {variant === 'header' && (
        <button
          onClick={handleInstallClick}
          className="min-h-[44px] bg-emerald-600 hover:bg-emerald-500 active:scale-[0.98] text-white px-3.5 py-2 rounded-xl font-semibold text-xs sm:text-sm flex items-center gap-2 transition-all shadow-sm"
          title="Install Ebook.AI to Home Screen"
        >
          <Smartphone size={16} className="shrink-0" />
          <span className="hidden sm:inline">Install App</span>
          <span className="sm:hidden">Install</span>
        </button>
      )}

      {variant === 'card' && (
        <button
          onClick={handleInstallClick}
          type="button"
          className="w-full min-h-[48px] bg-slate-900 hover:bg-slate-800 active:scale-[0.98] text-white font-semibold py-3 px-4 rounded-xl transition-all flex items-center justify-center gap-2.5 text-sm shadow-md"
        >
          <Download size={18} className="text-emerald-400 shrink-0" />
          <span>Download App to Home Screen</span>
        </button>
      )}

      {variant === 'banner' && (
        <div className="sm:hidden bg-gradient-to-r from-blue-950 via-slate-900 to-blue-950 text-white px-4 py-3 border-b border-blue-800/80 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="/icon.svg" alt="Ebook.AI" className="w-10 h-10 rounded-xl shadow-md shrink-0" />
            <div className="min-w-0">
              <div className="font-bold text-xs truncate">Install Ebook.AI App</div>
              <div className="text-[11px] text-blue-200 truncate">Full-screen offline reading &amp; voice capture</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={handleInstallClick}
              className="min-h-[38px] bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3.5 py-2 rounded-lg transition-colors"
            >
              Install
            </button>
            <button
              onClick={dismissBanner}
              className="p-2 text-blue-300 hover:text-white rounded-lg"
              aria-label="Dismiss install banner"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* Step-by-Step Home Screen Installation Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[100] bg-slate-950/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in">
          <div className="bg-white text-slate-900 w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl p-6 pb-8 sm:pb-6 shadow-2xl border border-slate-200 animate-in slide-in-from-bottom-4">
            <div className="w-10 h-1.5 bg-slate-300 rounded-full mx-auto mb-4 sm:hidden" />

            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <img src="/icon.svg" alt="Ebook.AI" className="w-12 h-12 rounded-2xl shadow-md" />
                <div>
                  <h3 className="text-lg font-serif font-bold text-slate-900">Add to Home Screen</h3>
                  <p className="text-xs text-slate-500">Install Ebook.AI as a native smartphone app</p>
                </div>
              </div>
              <button
                onClick={() => setShowModal(false)}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 rounded-full hover:bg-slate-100"
              >
                <X size={20} />
              </button>
            </div>

            {isInstallable && (
              <div className="mb-5">
                <button
                  onClick={async () => {
                    const ok = await promptInstall();
                    if (ok) setShowModal(false);
                  }}
                  className="w-full min-h-[48px] bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl py-3 px-4 flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
                >
                  <Download size={18} />
                  Install Directly Now
                </button>
              </div>
            )}

            <div className="space-y-4 text-sm text-slate-700 bg-slate-50 p-4 rounded-2xl border border-slate-100">
              {isIOS ? (
                <>
                  <div className="font-bold text-xs uppercase tracking-wider text-blue-700">
                    iPhone &amp; iPad (Safari)
                  </div>
                  <ol className="space-y-3 text-xs sm:text-sm">
                    <li className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs">
                        1
                      </span>
                      <span>
                        Tap the <strong>Share</strong> button{' '}
                        <Share className="inline w-4 h-4 mx-0.5 text-blue-600" /> in Safari&apos;s bottom bar.
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs">
                        2
                      </span>
                      <span>
                        Scroll down and tap <strong>Add to Home Screen</strong>{' '}
                        <PlusSquare className="inline w-4 h-4 mx-0.5 text-blue-600" />.
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs">
                        3
                      </span>
                      <span>
                        Tap <strong>Add</strong> in the top-right corner to launch full-screen.
                      </span>
                    </li>
                  </ol>
                </>
              ) : (
                <>
                  <div className="font-bold text-xs uppercase tracking-wider text-blue-700">
                    Android (Chrome / Edge) &amp; iOS (Safari)
                  </div>
                  <div className="space-y-3 text-xs sm:text-sm">
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs mt-0.5">
                        1
                      </span>
                      <div>
                        <strong>On Android Chrome:</strong> Tap the browser menu{' '}
                        <MoreVertical className="inline w-4 h-4 text-slate-600" /> (top right) and select{' '}
                        <strong>Install app</strong> or <strong>Add to Home screen</strong>.
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-xs mt-0.5">
                        2
                      </span>
                      <div>
                        <strong>On iPhone Safari:</strong> Tap <strong>Share</strong>{' '}
                        <Share className="inline w-4 h-4 text-blue-600" /> at the bottom of the screen, then tap{' '}
                        <strong>Add to Home Screen</strong> <PlusSquare className="inline w-4 h-4 text-blue-600" />.
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3.5 py-2.5">
              <CheckCircle2 size={16} className="shrink-0 text-emerald-600" />
              <span>Works offline for reading &amp; saves manuscripts locally to your device.</span>
            </div>

            <button
              onClick={() => setShowModal(false)}
              className="mt-5 w-full min-h-[48px] bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl py-3 text-sm transition-colors"
            >
              Got It
            </button>
          </div>
        </div>
      )}
    </>
  );
};
