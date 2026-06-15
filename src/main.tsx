import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastHost } from './components/ToastHost'
import { AudioManager } from './utils/audioManager'
import { isMuted } from './utils/localPrefs'

AudioManager.init();
AudioManager.setMuted(isMuted());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ToastHost />
    </ErrorBoundary>
  </StrictMode>,
)
