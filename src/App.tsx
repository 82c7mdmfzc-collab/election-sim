import './App.css';
import { useEffect, useRef, useState } from 'react';
import { CandidateSelect } from './components/CandidateSelect';
import { MultiplayerMenu } from './components/MultiplayerMenu';
import { GameShell } from './components/GameShell';
import { VersusScreen } from './components/VersusScreen';
import { ElectionTallyView } from './components/ElectionTallyView';
import { VictoryPodium } from './components/VictoryPodium';
import { Tutorial } from './components/Tutorial';
import { AuthGate } from './components/AuthGate';
import { Shop } from './components/Shop';
import { BotSetup } from './components/BotSetup';
import { Landing } from './components/Landing';
import { BrandMark } from './components/BrandMark';
import { UsernameClaim } from './components/UsernameClaim';
import { ScreenTransition } from './components/ScreenTransition';
import { isNativeRuntime } from './utils/platform';
import { useGameStore } from './game/store';
import { CANDIDATE_MAP } from './game/candidates';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useProfile, selectFunds, selectIsSignedIn } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { PlayIcon, MonitorIcon, GlobeIcon, CartIcon } from './components/icons';
import { isTutorialSeen } from './utils/localPrefs';
import { NextChallengeHint, ProgressPanel } from './components/ProgressPanel';
import {
  identifyAccount,
  resetAnalyticsIdentity,
  setAnalyticsAccountState,
  track,
} from './utils/analytics';
import type { ComponentType, ReactNode } from 'react';
import type { BotDifficulty } from './game/types';

type AppMode = 'mode-select' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot';
type TutorialSource = 'menu' | 'onboarding';
type ShopSource = 'menu' | 'locked_candidate' | 'account';

interface ModeDef {
  mode: AppMode;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  chip: 'orange' | 'blue';
  primary?: boolean;
}

const MODES: ModeDef[] = [
  { mode: 'bot',    label: 'Play',        Icon: PlayIcon,    chip: 'orange', primary: true },
  { mode: 'single', label: 'Pass & Play', Icon: MonitorIcon, chip: 'blue' },
  { mode: 'online', label: 'Online',      Icon: GlobeIcon,   chip: 'orange' },
  { mode: 'shop',   label: 'Shop',        Icon: CartIcon,    chip: 'blue' },
];

function appModeToShopSource(mode: AppMode): ShopSource {
  return mode === 'single' ? 'locked_candidate' : 'menu';
}

function ModeSelect({ onSelect, onTutorial, onAccount }: {
  onSelect: (mode: AppMode) => void;
  onTutorial: () => void;
  onAccount: () => void;
}) {
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

      {signedIn && (
        <div className="home__progress">
          <ProgressPanel compact showAll={false} />
          <NextChallengeHint />
        </div>
      )}

      <button type="button" className="home__link" onClick={onTutorial}>
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
  const versusPending = useGameStore((s) => s.versusPending);
  const initProfile = useProfile((s) => s.init);
  const ready = useProfile((s) => s.ready);
  const signedIn = useProfile(selectIsSignedIn);
  const userId = useProfile((s) => s.userId);
  const displayName = useProfile((s) => s.displayName);
  const startGame = useGameStore((s) => s.startGame);
  const [showAccount, setShowAccount] = useState(false);
  // Session-only: a signed-out visitor sees the landing on every fresh load, but
  // can choose to continue as a guest for the rest of this session.
  const [guestContinued, setGuestContinued] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('mode-select');
  const [tutorialSource, setTutorialSource] = useState<TutorialSource>('menu');
  const [shopSource, setShopSource] = useState<ShopSource>('menu');
  const appOpenTracked = useRef(false);

  useEffect(() => { void initProfile(); }, [initProfile]);

  useEffect(() => {
    setAnalyticsAccountState(signedIn);
    if (signedIn && userId) {
      identifyAccount(userId);
      const pendingMethod = window.sessionStorage.getItem('elector.pendingAuthMethod');
      if (pendingMethod === 'apple' || pendingMethod === 'google') {
        track('auth_completed', { method: pendingMethod, mode: 'signin' });
        window.sessionStorage.removeItem('elector.pendingAuthMethod');
      }
    }
    if (!signedIn) resetAnalyticsIdentity();
  }, [signedIn, userId]);

  useEffect(() => {
    if (!ready || appOpenTracked.current) return;
    appOpenTracked.current = true;
    track('app_opened', {
      entry_surface: signedIn ? 'menu' : 'landing',
      has_saved_session: signedIn,
    });
  }, [ready, signedIn]);

  // Native keyboard avoidance: when a text field is focused the on-screen keyboard
  // can cover it (sign-in email/code, username, lobby code). One global handler
  // scrolls the focused input into view once the keyboard has animated in. Native
  // only — the website relies on normal browser behavior.
  useEffect(() => {
    if (!isNativeRuntime()) return;
    function onFocusIn(e: FocusEvent) {
      const t = e.target as HTMLElement | null;
      if (!t || (t.tagName !== 'INPUT' && t.tagName !== 'TEXTAREA')) return;
      window.setTimeout(() => {
        t.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 280);
    }
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, []);

  function selectMode(mode: AppMode) {
    if (mode === 'shop') setShopSource(appModeToShopSource(appMode));
    setAppMode(mode);
  }

  function openAccount(trigger: 'account_button' | 'shop_gate' | 'online_gate' | 'other' = 'account_button') {
    track('account_prompt_opened', { trigger });
    setShowAccount(true);
  }

  function startPracticeGame() {
    const human = CANDIDATE_MAP.tooley;
    const opponent = CANDIDATE_MAP.trump;
    const botSeats: Record<string, BotDifficulty> = { [opponent.id]: 'easy' };
    setGuestContinued(true);
    setAppMode('bot');
    startGame([human, opponent], null, botSeats);
  }

  function continueAsGuest() {
    setGuestContinued(true);
    if (isTutorialSeen()) {
      startPracticeGame();
      return;
    }
    setTutorialSource('onboarding');
    setAppMode('tutorial');
  }

  function openTutorial() {
    setTutorialSource('menu');
    setAppMode('tutorial');
  }

  // ── Decide which top-level screen to show ────────────────────────────────────
  // Each branch sets `screen` + `screenKey`; the single <ScreenTransition> below
  // animates whenever screenKey changes so navigation feels native, not web-y.
  // The account modal (AuthGate) overlays independently, outside the transition.
  const account = showAccount ? <AuthGate onClose={() => setShowAccount(false)} /> : null;

  let screen: ReactNode;
  let screenKey: string;

  // Once a game is running, route to the correct view regardless of appMode.
  if (phase === 'ELECTION_TALLY') {
    screen = <ElectionTallyView />;
    screenKey = 'tally';
  } else if (phase === 'GAME_OVER') {
    screen = <VictoryPodium />;
    screenKey = 'gameover';
  } else if (phase !== 'SETUP' && phase !== 'MENU') {
    // Show the matchup intro once at the start of a game, before the board.
    if (versusPending) {
      screen = <VersusScreen />;
      screenKey = 'versus';
    } else {
      screen = <GameShell />;
      screenKey = 'game';
    }
  } else if (!ready) {
    // Wait for the auth/profile check before deciding, so a signed-in user never
    // flashes the landing page on load.
    screen = <div className="landing landing--splash"><BrandMark /></div>;
    screenKey = 'splash';
  } else if (!signedIn && !guestContinued) {
    // Signed-out front door — shown on every fresh load until "Continue as Guest".
    screen = (
      <Landing
        onContinueAsGuest={continueAsGuest}
        primaryLabel={isTutorialSeen() ? 'Start Solo' : 'Learn & Start'}
      />
    );
    screenKey = 'landing';
  } else if (signedIn && !displayName) {
    // One-time, mandatory username claim immediately after a new account signs in.
    screen = (
      <div className="landing">
        <BrandMark />
        <div className="landing__card">
          <h2 className="landing__title">Choose your username</h2>
          <UsernameClaim />
        </div>
      </div>
    );
    screenKey = 'username';
  } else if (appMode === 'tutorial') {
    screen = (
      <Tutorial
        source={tutorialSource}
        onFinish={() => {
          if (tutorialSource === 'onboarding') startPracticeGame();
          else setAppMode('bot');
        }}
        onSkip={() => {
          if (tutorialSource === 'onboarding') startPracticeGame();
          else setAppMode('mode-select');
        }}
      />
    );
    screenKey = 'tutorial';
  } else if (appMode === 'shop') {
    screen = signedIn ? (
      <Shop source={shopSource} onBack={() => setAppMode('mode-select')} />
    ) : (
      <GuestGate
        title="Campaign Shop"
        message="Sign in to keep Campaign Funds, unlocks, and your roster synced across devices."
        onBack={() => setAppMode('mode-select')}
        onSignIn={() => openAccount('shop_gate')}
      />
    );
    screenKey = 'shop';
  } else if (appMode === 'bot') {
    screen = <BotSetup onBack={() => setAppMode('mode-select')} />;
    screenKey = 'bot';
  } else if (appMode === 'online') {
    screen = (
      <MultiplayerMenu
        onBack={() => setAppMode('mode-select')}
        onOpenAccount={() => openAccount('online_gate')}
      />
    );
    screenKey = 'online';
  } else if (appMode === 'single') {
    screen = (
      <CandidateSelect
        onBack={() => setAppMode('mode-select')}
        onOpenShop={() => {
          setShopSource('locked_candidate');
          setAppMode('shop');
        }}
      />
    );
    screenKey = 'single';
  } else {
    screen = (
      <ModeSelect
        onSelect={selectMode}
        onTutorial={openTutorial}
        onAccount={() => openAccount('account_button')}
      />
    );
    screenKey = 'menu';
  }

  return (
    <>
      <ScreenTransition screenKey={screenKey}>{screen}</ScreenTransition>
      {account}
    </>
  );
}

export default App;
