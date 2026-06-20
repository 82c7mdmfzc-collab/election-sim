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
import { Landing } from './components/Landing';
import { BrandMark } from './components/BrandMark';
import { UsernameClaim } from './components/UsernameClaim';
import { useGameStore } from './game/store';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useProfile, selectFunds, selectIsSignedIn } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { PlayIcon, MonitorIcon, GlobeIcon, CartIcon } from './components/icons';
import type { ComponentType } from 'react';

type AppMode = 'mode-select' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot';

interface ModeDef {
  mode: AppMode;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  chip: 'orange' | 'blue';
  primary?: boolean;
}

const MODES: ModeDef[] = [
  { mode: 'single', label: 'Play',        Icon: PlayIcon,    chip: 'orange', primary: true },
  { mode: 'bot',    label: 'Solo',        Icon: MonitorIcon, chip: 'blue' },
  { mode: 'online', label: 'Online',      Icon: GlobeIcon,   chip: 'orange' },
  { mode: 'shop',   label: 'Shop',        Icon: CartIcon,    chip: 'blue' },
];

function ModeSelect({ onSelect, onAccount }: { onSelect: (mode: AppMode) => void; onAccount: () => void }) {
  const funds = useProfile(selectFunds);
  const signedIn = useProfile(selectIsSignedIn);
  return (
    <div className="home">
      <button type="button" className="home__coin gold-pill" onClick={onAccount} title="Your account">
        {signedIn ? (
          <>
            <span className="gold-pill__coin" aria-hidden />
            <span className="home__coin-count">{funds.toLocaleString()}</span>
            <span className="home__coin-plus" aria-hidden>+</span>
          </>
        ) : (
          'Sign In'
        )}
      </button>

      <div className="home__crest">
        <img
          src="/assets/brand/star_wings.png"
          alt=""
          className="home__crest-img"
          draggable={false}
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
        <BrandMark />
      </div>

      <div className="home__modes">
        {MODES.map(({ mode, label, Icon, chip, primary }) => (
          <button
            key={mode}
            type="button"
            className={`menu-btn${primary ? ' menu-btn--primary' : ''}`}
            onClick={() => onSelect(mode)}
          >
            <span className={`menu-btn__chip menu-btn__chip--${chip}`}><Icon size={24} /></span>
            <span className="menu-btn__label">{label}</span>
          </button>
        ))}
      </div>

      <button type="button" className="home__link" onClick={() => onSelect('tutorial')}>
        How to Play
      </button>
    </div>
  );
}

/** Sign-in wall for account-only features (the shop). */
function GuestGate({ title, message, onBack, onSignIn }: {
  title: string; message: string; onBack: () => void; onSignIn: () => void;
}) {
  return (
    <div className="setup">
      <div className="setup__header"><h1 className="setup__title">{title}</h1></div>
      <div className="mp-wait">
        <p className="mp-wait__hint">{message}</p>
        <button type="button" className="setup__start" style={{ marginTop: '1rem' }} onClick={onSignIn}>
          Sign In
        </button>
        <button type="button" className="mp-back" onClick={onBack}>← Back</button>
      </div>
    </div>
  );
}

function App() {
  useSessionRestore();
  useGameRewards();
  const phase = useGameStore((s) => s.phase);
  const initProfile = useProfile((s) => s.init);
  const ready = useProfile((s) => s.ready);
  const signedIn = useProfile(selectIsSignedIn);
  const displayName = useProfile((s) => s.displayName);
  const [showAccount, setShowAccount] = useState(false);
  // Session-only: a signed-out visitor sees the landing on every fresh load, but
  // can choose to continue as a guest for the rest of this session.
  const [guestContinued, setGuestContinued] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('mode-select');

  useEffect(() => { void initProfile(); }, [initProfile]);

  // Once a game is running, route to the correct view regardless of appMode
  if (phase === 'ELECTION_TALLY') return <ElectionTallyView />;
  if (phase === 'GAME_OVER') return <VictoryPodium />;
  if (phase !== 'SETUP' && phase !== 'MENU') return <GameShell />;

  // Wait for the auth/profile check before deciding, so a signed-in user never
  // flashes the landing page on load.
  if (!ready) {
    return <div className="landing landing--splash"><BrandMark /></div>;
  }

  // Signed-out front door — shown on every fresh load until "Continue as Guest".
  if (!signedIn && !guestContinued) {
    return <Landing onContinueAsGuest={() => { setGuestContinued(true); setAppMode('bot'); }} />;
  }

  // One-time, mandatory username claim immediately after a new account signs in.
  if (signedIn && !displayName) {
    return (
      <div className="landing">
        <BrandMark />
        <div className="landing__card">
          <h2 className="landing__title">Choose your username</h2>
          <UsernameClaim />
        </div>
      </div>
    );
  }

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

  if (appMode === 'shop') {
    return signedIn ? (
      <Shop onBack={() => setAppMode('mode-select')} />
    ) : (
      <>
        <GuestGate
          title="Campaign Shop"
          message="Sign in to keep Campaign Funds, unlocks, and your roster synced across devices."
          onBack={() => setAppMode('mode-select')}
          onSignIn={() => setShowAccount(true)}
        />
        {account}
      </>
    );
  }
  if (appMode === 'bot') return <BotSetup onBack={() => setAppMode('mode-select')} />;
  if (appMode === 'online') return <><MultiplayerMenu onBack={() => setAppMode('mode-select')} onOpenAccount={() => setShowAccount(true)} />{account}</>;
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
