import './App.css';
import { useEffect, useState } from 'react';
import { CandidateSelect } from './components/CandidateSelect';
import { MultiplayerMenu } from './components/MultiplayerMenu';
import { GameShell } from './components/GameShell';
import { ElectionTallyView } from './components/ElectionTallyView';
import { VictoryPodium } from './components/VictoryPodium';
import { Tutorial } from './components/Tutorial';
import { AuthGate } from './components/AuthGate';
import { Shop } from './components/Shop';
import { BotSetup } from './components/BotSetup';
import { useGameStore } from './game/store';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useProfile, selectFunds } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { isTutorialSeen } from './utils/localPrefs';

type AppMode = 'mode-select' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot';

function ModeSelect({ onSelect, onAccount }: { onSelect: (mode: AppMode) => void; onAccount: () => void }) {
  const funds = useProfile(selectFunds);
  return (
    <div className="setup">
      <button type="button" className="account-chip" onClick={onAccount} title="Your account">
        💰 {funds.toLocaleString()}
      </button>
      <div className="setup__hero">
        <div className="setup__eyebrow">ELECTION NIGHT SIMULATOR</div>
        <h1 className="setup__number">270</h1>
        <div className="setup__rule" aria-hidden />
        <p className="setup__sub">Battle for the Electoral College</p>
      </div>
      <div className="setup__actions">
        <button
          type="button"
          className="setup__start"
          onClick={() => onSelect('single')}
        >
          Hot-Seat — Single Device
        </button>
        <button
          type="button"
          className="setup__start setup__start--secondary"
          onClick={() => onSelect('bot')}
        >
          vs Bot — Single Player
        </button>
        <button
          type="button"
          className="setup__start setup__start--secondary"
          onClick={() => onSelect('online')}
        >
          Online Multiplayer
        </button>
        <button
          type="button"
          className="setup__start setup__start--secondary"
          onClick={() => onSelect('shop')}
        >
          🛒 Campaign Shop
        </button>
        <button
          type="button"
          className="setup__link"
          onClick={() => onSelect('tutorial')}
        >
          How to Play
        </button>
      </div>
    </div>
  );
}

function App() {
  useSessionRestore();
  useGameRewards();
  const phase = useGameStore((s) => s.phase);
  const initProfile = useProfile((s) => s.init);
  const [showAccount, setShowAccount] = useState(false);
  // First-ever launch auto-opens the tutorial; afterward start on the menu.
  const [appMode, setAppMode] = useState<AppMode>(() =>
    isTutorialSeen() ? 'mode-select' : 'tutorial',
  );

  useEffect(() => { void initProfile(); }, [initProfile]);

  // Once a game is running, route to the correct view regardless of appMode
  if (phase === 'ELECTION_TALLY') return <ElectionTallyView />;
  if (phase === 'GAME_OVER') return <VictoryPodium />;
  if (phase !== 'SETUP' && phase !== 'MENU') return <GameShell />;

  // Pre-game routing
  if (appMode === 'tutorial') {
    return (
      <Tutorial
        onFinish={() => setAppMode('single')}
        onSkip={() => setAppMode('mode-select')}
      />
    );
  }

  const account = showAccount ? <AuthGate onClose={() => setShowAccount(false)} /> : null;

  if (appMode === 'shop') return <Shop onBack={() => setAppMode('mode-select')} />;
  if (appMode === 'bot') return <BotSetup onBack={() => setAppMode('mode-select')} />;
  if (appMode === 'online') return <><MultiplayerMenu onBack={() => setAppMode('mode-select')} />{account}</>;
  if (appMode === 'single') {
    return (
      <>
        <CandidateSelect onBack={() => setAppMode('mode-select')} onOpenShop={() => setAppMode('shop')} />
        {account}
      </>
    );
  }
  return <><ModeSelect onSelect={setAppMode} onAccount={() => setShowAccount(true)} />{account}</>;
}

export default App;
