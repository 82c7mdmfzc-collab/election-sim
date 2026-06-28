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
import { DailyChallenge } from './components/DailyChallenge';
import { Landing } from './components/Landing';
import { BrandMark } from './components/BrandMark';
import { UsernameClaim } from './components/UsernameClaim';
import { HomeAudioControls } from './components/MuteButton';
import { ScreenTransition } from './components/ScreenTransition';
import { isNativeRuntime } from './utils/platform';
import { useGameStore } from './game/store';
import { CANDIDATE_MAP } from './game/candidates';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useProfile, selectFunds, selectIsSignedIn } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { PlayIcon, MonitorIcon, GlobeIcon, CartIcon, TrophyIcon } from './components/icons';
import { isTutorialSeen, getDailyChallengeLocal } from './utils/localPrefs';
import { AudioManager } from './utils/audioManager';
import { NextChallengeHint, ProgressPanel } from './components/ProgressPanel';
import {
  identifyAccount,
  resetAnalyticsIdentity,
  setAnalyticsAccountState,
  track,
} from './utils/analytics';
import type { ComponentType, ReactNode } from 'react';
import type { BotDifficulty } from './game/types';

type AppMode = 'mode-select' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot' | 'daily';
type TutorialSource = 'menu' | 'onboarding';
type ShopSource = 'menu' | 'locked_candidate' | 'account';

interface ModeDef {
  mode: AppMode;
  label: string;
  Icon: ComponentType<{ size?: number }>;
  chip: 'orange' | 'blue';
  primary?: boolean;
  /** Small overlay pill (e.g. the Daily streak/"New" hook). */
  badge?: string;
}

/** The Daily tile's live badge: the active streak, or "New" until first played. */
function dailyBadge(): string | undefined {
  const d = getDailyChallengeLocal();
  if (d.streak > 0) return `🔥 ${d.streak}`;
  return d.lastPlayedDate == null ? 'New' : undefined;
}

const MODES: ModeDef[] = [
  { mode: 'bot',    label: 'Play',        Icon: PlayIcon,    chip: 'orange', primary: true },
  { mode: 'daily',  label: 'Daily Race',  Icon: TrophyIcon,  chip: 'orange' },
  { mode: 'single', label: 'Local',       Icon: MonitorIcon, chip: 'blue' },
  { mode: 'online', label: 'Online',      Icon: GlobeIcon,   chip: 'orange' },
  { mode: 'shop',   label: 'Store',       Icon: CartIcon,    chip: 'blue' },
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
  const native = isNativeRuntime();
  const [progressOpen, setProgressOpen] = useState(false);
  // A persisted in-progress game is offered as an explicit Resume on Home, rather
  // than auto-reopening the board on launch (see the viewingGame gate in App).
  const phase = useGameStore((s) => s.phase);
  const resumeGame = useGameStore((s) => s.resumeGame);
  const hasResumableGame = phase === 'PLANNING' || phase === 'RESOLUTION' || phase === 'ELECTION';
  return (
    <div className="home">
      <HomeAudioControls />
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
        <BrandMark />
      </div>

      {hasResumableGame && (
        <button
          type="button"
          className="home__resume btn-cta"
          onClick={() => { AudioManager.play('confirm'); resumeGame(); }}
        >
          Resume Campaign →
        </button>
      )}

      <div className="home__modes">
        {MODES.map(({ mode, label, Icon, chip, primary, badge }) => {
          const b = native && signedIn && mode === 'daily' ? undefined : (mode === 'daily' ? dailyBadge() : badge);
          return (
            <button
              key={mode}
              type="button"
              className={`menu-btn${primary ? ' menu-btn--primary' : ''}`}
              onClick={() => { AudioManager.play('click'); onSelect(mode); }}
            >
              <span className={`menu-btn__chip menu-btn__chip--${chip}`}><Icon size={24} /></span>
              <span className="menu-btn__label">{label}</span>
              {b && <span className="menu-btn__badge">{b}</span>}
            </button>
          );
        })}
      </div>

      {signedIn && (
        native ? (
          <div className="home__progress-native">
            <button
              type="button"
              className="home__progress-toggle"
              aria-expanded={progressOpen}
              onClick={() => { AudioManager.play('click'); setProgressOpen((o) => !o); }}
            >
              Your progress
              <span className="home__progress-chevron" aria-hidden>{progressOpen ? '▴' : '▾'}</span>
            </button>
            {progressOpen && (
              <div className="home__progress-panel">
                <ProgressPanel compact showAll={false} />
                <NextChallengeHint />
              </div>
            )}
          </div>
        ) : (
          <div className="home__progress">
            <ProgressPanel compact showAll={false} />
            <NextChallengeHint />
          </div>
        )
      )}

      <button type="button" className="home__link" onClick={onTutorial}>
        Campaign Guide
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
  const viewingGame = useGameStore((s) => s.viewingGame);
  const initProfile = useProfile((s) => s.init);
  const ready = useProfile((s) => s.ready);
  const signedIn = useProfile(selectIsSignedIn);
  const userId = useProfile((s) => s.userId);
  const displayName = useProfile((s) => s.displayName);
  const accountChecked = useProfile((s) => s.accountChecked);
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

  // Background music plays from app launch (subject to the per-track mute/volume
  // prefs). If the browser blocks autoplay before the first gesture, AudioManager
  // queues the loop and starts it on the first tap/click. Continuous across the
  // menu and gameplay; users silence it via the home-page sound dial.
  useEffect(() => { AudioManager.startMusic(); }, []);

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
    if (mode === 'daily') track('daily_challenge_opened', { entry_surface: 'menu' });
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
    if (!isTutorialSeen()) {
      setTutorialSource('onboarding');
      setAppMode('tutorial');
      return;
    }
    startPracticeGame();
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

  // Once a game is running AND the player is actively viewing it this session,
  // route to the correct view regardless of appMode. `viewingGame` is never
  // persisted, so on a cold boot a saved in-progress game does NOT auto-open — the
  // player lands on Home and resumes explicitly (see ModeSelect's Resume CTA).
  if (viewingGame && phase === 'ELECTION_TALLY') {
    screen = <ElectionTallyView />;
    screenKey = 'tally';
  } else if (viewingGame && phase === 'GAME_OVER') {
    screen = <VictoryPodium />;
    screenKey = 'gameover';
  } else if (viewingGame && phase !== 'SETUP' && phase !== 'MENU') {
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
  } else if (signedIn && !displayName && !accountChecked) {
    // Signed in but the account fetch hasn't settled yet — hold the branded splash
    // rather than flashing the username prompt at a user who already has a name.
    screen = <div className="landing landing--splash"><BrandMark /></div>;
    screenKey = 'splash';
  } else if (signedIn && !displayName) {
    // One-time, mandatory username claim — only once we KNOW there's no username
    // (accountChecked is true here), so this never flashes for existing accounts.
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
  } else if (appMode === 'daily') {
    screen = <DailyChallenge onBack={() => setAppMode('mode-select')} />;
    screenKey = 'daily';
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
