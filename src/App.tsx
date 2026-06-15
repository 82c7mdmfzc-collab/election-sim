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
import { useProfile, selectFunds, selectIsSignedIn } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { isTutorialSeen } from './utils/localPrefs';
import { BotIcon, GlobeIcon, CartIcon, UsersIcon } from './components/icons';
import type { ComponentType } from 'react';

type AppMode = 'mode-select' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot';

/** Elector brand mark — logo image with a styled-text fallback if art is absent. */
function BrandMark() {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="brand">
      {!imgFailed ? (
        <img
          className="brand__logo"
          src="/assets/brand/elector_logo.png"
          alt="Elector"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="brand__wordmark">Elect<span className="brand__accent">o</span>r</div>
      )}
      <p className="brand__tagline">Win the Electoral College</p>
    </div>
  );
}

interface ModeDef {
  mode: AppMode;
  label: string;
  sub: string;
  Icon: ComponentType<{ size?: number }>;
  primary?: boolean;
}

const MODES: ModeDef[] = [
  { mode: 'single', label: 'Hot-Seat',  sub: 'Pass & play on one device', Icon: UsersIcon, primary: true },
  { mode: 'bot',    label: 'vs Bot',    sub: 'Play against the computer', Icon: BotIcon },
  { mode: 'online', label: 'Online',    sub: 'Host or join a game',       Icon: GlobeIcon },
  { mode: 'shop',   label: 'Shop',      sub: 'Candidates & cosmetics',    Icon: CartIcon },
];

function ModeSelect({ onSelect, onAccount }: { onSelect: (mode: AppMode) => void; onAccount: () => void }) {
  const funds = useProfile(selectFunds);
  const signedIn = useProfile(selectIsSignedIn);
  return (
    <div className="home">
      <button type="button" className="account-chip" onClick={onAccount} title="Your account">
        {signedIn ? (
          <>
            <span className="account-chip__coin" aria-hidden />
            {funds.toLocaleString()}
          </>
        ) : (
          'Sign In'
        )}
      </button>

      <BrandMark />

      <div className="home__modes">
        {MODES.map(({ mode, label, sub, Icon, primary }) => (
          <button
            key={mode}
            type="button"
            className={`mode-card${primary ? ' mode-card--primary' : ''}`}
            onClick={() => onSelect(mode)}
          >
            <span className="mode-card__icon"><Icon size={26} /></span>
            <span className="mode-card__text">
              <span className="mode-card__label">{label}</span>
              <span className="mode-card__sub">{sub}</span>
            </span>
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
  const signedIn = useProfile(selectIsSignedIn);
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

  if (appMode === 'shop') {
    return signedIn ? (
      <Shop onBack={() => setAppMode('mode-select')} />
    ) : (
      <>
        <GuestGate
          title="Campaign Shop"
          message="Sign in to earn Campaign Funds and unlock new candidates. Your roster syncs across every device."
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
