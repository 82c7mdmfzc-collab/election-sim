import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AudioManager } from './utils/audioManager'
import { isMuted } from './utils/localPrefs'

AudioManager.init();
AudioManager.setMuted(isMuted());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
