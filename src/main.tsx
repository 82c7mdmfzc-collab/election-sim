import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastHost } from './components/ToastHost'
import { OrientationGate } from './components/OrientationGate'
import { AudioManager } from './utils/audioManager'
import { isMuted } from './utils/localPrefs'
import { initAnalytics } from './utils/analytics'

AudioManager.init();
AudioManager.setMuted(isMuted());
initAnalytics();

// Global UI click sound. Any <button>/[role=button] plays a click on press,
// unless an ancestor opts out with data-sfx="none" (e.g. the in-game shell,
// which wires its own richer SFX). data-sfx="confirm" / "back" override the
// sound. The AudioManager de-dupes, so explicit play('click') calls collapse.
document.addEventListener(
  'pointerdown',
  (e) => {
    const target = e.target as HTMLElement | null;
    const btn = target?.closest('button, [role="button"]') as HTMLElement | null;
    if (!btn || btn.hasAttribute('disabled') || btn.getAttribute('aria-disabled') === 'true') return;
    const sfxEl = (target?.closest('[data-sfx]') as HTMLElement | null);
    const sfx = sfxEl?.dataset.sfx;
    if (sfx === 'none') return;
    AudioManager.play(sfx === 'confirm' ? 'confirm' : sfx === 'back' ? 'quit' : 'click');
  },
  { capture: true },
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ToastHost />
      <OrientationGate />
    </ErrorBoundary>
  </StrictMode>,
)
