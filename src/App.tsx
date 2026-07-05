import './App.css';
import { useEffect, useRef, useState } from 'react';
import { CandidateSelect } from './components/CandidateSelect';
import { MultiplayerMenu } from './components/MultiplayerMenu';
import { GameShell } from './components/GameShell';
import { VersusScreen } from './components/VersusScreen';
import { ModifierRoll } from './components/ModifierRoll';
import { ActiveModifierChip } from './components/ActiveModifierChip';
import { ElectionTallyView } from './components/ElectionTallyView';
import { VictoryPodium } from './components/VictoryPodium';
import { Tutorial } from './components/Tutorial';
import { AuthGate } from './components/AuthGate';
import { Shop } from './components/Shop';
import { SeasonPass } from './components/SeasonPass';
import { claimableCount } from './game/season';
import { BotSetup } from './components/BotSetup';
import { DailyChallenge } from './components/DailyChallenge';
import { Landing } from './components/Landing';
import { BrandMark } from './components/BrandMark';
import { UsernameClaim } from './components/UsernameClaim';
import { HomeAudioControls } from './components/MuteButton';
import { Leaderboard } from './components/Leaderboard';
import { Settings } from './components/Settings';
import { ScreenTransition } from './components/ScreenTransition';
import { isNativeRuntime } from './utils/platform';
import { useGameStore } from './game/store';
import { useSessionRestore } from './hooks/useSessionRestore';
import { useProfile, selectFunds, selectIsSignedIn } from './hooks/useProfile';
import { useGameRewards } from './hooks/useGameRewards';
import { useAndroidBack } from './hooks/useAndroidBack';
import { PlayIcon, MonitorIcon, GlobeIcon, CartIcon, TrophyIcon, RankingsIcon, SettingsIcon, SeasonIcon, FlameIcon } from './components/icons';
import { isTutorialSeen, getDailyChallengeLocal } from './utils/localPrefs';
import { AudioManager } from './utils/audioManager';
import { applyAppearancePrefs } from './utils/appearance';
import { NextChallengeHint } from './components/ProgressPanel';
import { HomePlayerCard } from './components/HomePlayerCard';
import { BackButton } from './components/BackButton';
import { DailyBonusChest } from './components/DailyBonusChest';
import {
  identifyAccount,
  resetAnalyticsIdentity,
  setAnalyticsAccountState,
  track,
} from './utils/analytics';
import type { ComponentType, ReactNode } from 'react';

type AppMode = 'mode-select' | 'play' | 'single' | 'online' | 'tutorial' | 'shop' | 'bot' | 'daily' | 'leaderboard' | 'season';
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
function dailyBadge(): ReactNode | undefined {
  const d = getDailyChallengeLocal();
  if (d.streak > 0) return <><FlameIcon size={12} /> {d.streak}</>;
  return d.lastPlayedDate == null ? 'New' : undefined;
}

/** The compact hub tiles beside the hero CTA (Play lives in the hero). */
const HUB_TILES: ModeDef[] = [
  { mode: 'season',      label: 'Season', Icon: SeasonIcon,   chip: 'orange' },
  { mode: 'leaderboard', label: 'Ranks',  Icon: RankingsIcon, chip: 'blue' },
  { mode: 'shop',        label: 'Store',  Icon: CartIcon,     chip: 'blue' },
];

const PLAY_MODES: ModeDef[] = [
  { mode: 'bot',    label: 'Solo Campaign',   Icon: PlayIcon,    chip: 'orange', primary: true },
  { mode: 'daily',  label: 'Daily Race',      Icon: TrophyIcon,  chip: 'orange' },
  { mode: 'single', label: 'Local Pass & Play', Icon: MonitorIcon, chip: 'blue' },
  { mode: 'online', label: 'Online',          Icon: GlobeIcon,   chip: 'orange' },
];

function appModeToShopSource(mode: AppMode): ShopSource {
  return mode === 'single' ? 'locked_candidate' : 'menu';
}

function ModeSelect({ onSelect, onTutorial, onAccount, onSettings, onOpeningCampaign }: {
  onSelect: (mode: AppMode) => void;
  onTutorial: () => void;
  onAccount: () => void;
  onSettings: () => void;
  onOpeningCampaign: () => void;
}) {
  const funds = useProfile(selectFunds);
  const signedIn = useProfile(selectIsSignedIn);
  const gamesFinished = useProfile((s) => s.profile.achievementCounters.gamesFinished);
  const season = useProfile((s) => s.season);
  const seasonClaimable = season ? claimableCount(season) : 0;
  // A persisted in-progress game is offered as an explicit Resume on Home, rather
  // than auto-reopening the board on launch (see the viewingGame gate in App).
  const phase = useGameStore((s) => s.phase);
  const resumeGame = useGameStore((s) => s.resumeGame);
  const hasResumableGame = phase === 'PLANNING' || phase === 'RESOLUTION' || phase === 'ELECTION';

  // One hero action per visit: resume a live game > a new player's first
  // campaign > start playing. Everything else is a subordinate tile.
  const hero = hasResumableGame
    ? { label: 'Resume Campaign', onPress: () => { AudioManager.play('confirm'); resumeGame(); } }
    : signedIn && gamesFinished === 0
      ? { label: 'Opening Campaign', onPress: () => { AudioManager.play('confirm'); onOpeningCampaign(); } }
      : { label: 'Play', onPress: () => { AudioManager.play('click'); onSelect('play'); } };

  const daily = getDailyChallengeLocal();

  return (
    <div className="home">
      <button
        type="button"
        className="home-settings"
        onClick={() => { AudioManager.play('click'); onSettings(); }}
        aria-label="Settings"
        title="Settings"
      >
        <SettingsIcon size={20} />
      </button>
      <button
        type="button"
        className="home__coin gold-pill"
        onClick={() => {
          AudioManager.play('click');
          if (signedIn) onSelect('shop');
          else onAccount();
        }}
        title={signedIn ? 'Campaign Funds — open the Store' : 'Sign in to your account'}
        aria-label={signedIn ? `${funds.toLocaleString()} Campaign Funds — open the Store` : 'Sign in to your account'}
      >
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

      <div className="home__identity">
        <div className="home__crest">
          <BrandMark />
        </div>
        <HomePlayerCard onOpen={onAccount} />
      </div>

      <div className="home__actions">
        <button type="button" className="home__hero btn-cta btn-cta--lg btn-cta--chevron" onClick={hero.onPress}>
          {hero.label}
        </button>
        <div className="home__tiles">
          {HUB_TILES.map(({ mode, label, Icon, chip }) => {
            let b: ReactNode;
            if (mode === 'season' && signedIn && seasonClaimable > 0) b = `${seasonClaimable}`;
            else if (mode === 'season' && signedIn && season?.season && !season.progress.premium) b = 'New';
            return (
              <button
                key={mode}
                type="button"
                className="menu-tile pressable"
                onClick={() => { AudioManager.play('click'); onSelect(mode); }}
              >
                <span className={`menu-tile__chip menu-btn__chip menu-btn__chip--${chip}`}><Icon size={22} /></span>
                <span className="menu-tile__label">{label}</span>
                {b && <span className="menu-btn__badge menu-tile__badge">{b}</span>}
              </button>
            );
          })}
        </div>
      </div>

      <div className="home__events">
        <button
          type="button"
          className="event-card event-card--daily pressable"
          onClick={() => { AudioManager.play('click'); onSelect('daily'); }}
        >
          <span className="event-card__icon" aria-hidden><FlameIcon size={18} /></span>
          <span className="event-card__text">
            <span className="event-card__title">Daily Race</span>
            <span className="event-card__sub">Same map, one shot — beat today's field</span>
          </span>
          {daily.streak > 0 ? (
            <span className="event-card__badge"><FlameIcon size={11} /> {daily.streak}</span>
          ) : daily.lastPlayedDate == null ? (
            <span className="event-card__badge">New</span>
          ) : null}
        </button>
        {hasResumableGame && (
          <button
            type="button"
            className="event-card event-card--ghost pressable"
            onClick={() => { AudioManager.play('click'); onSelect('play'); }}
          >
            <span className="event-card__icon" aria-hidden><PlayIcon size={18} /></span>
            <span className="event-card__text">
              <span className="event-card__title">New Game</span>
              <span className="event-card__sub">Start a fresh campaign</span>
            </span>
          </button>
        )}
        {signedIn && <NextChallengeHint />}
        <button type="button" className="home__link" onClick={onTutorial}>
          Campaign Guide
        </button>
      </div>
    </div>
  );
}

function PlayModeSelect({ onSelect, onBack }: {
  onSelect: (mode: AppMode) => void;
  onBack: () => void;
}) {
  const signedIn = useProfile(selectIsSignedIn);
  const native = isNativeRuntime();

  return (
    <div className="setup native-screen play-mode">
      <div className="setup__header play-mode__header">
        <h1 className="setup__title">Play</h1>
        <p className="setup__sub">Choose your campaign mode.</p>
      </div>

      <div className="play-mode__modes">
        {PLAY_MODES.map(({ mode, label, Icon, chip, primary }) => {
          const b = native && signedIn && mode === 'daily' ? undefined : (mode === 'daily' ? dailyBadge() : undefined);
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

      <BackButton onClick={onBack} silent />
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
        <button type="button" className="setup__start guest-gate__signin" onClick={onSignIn}>
          Sign In
        </button>
        <BackButton onClick={onBack} silent />
      </div>
    </div>
  );
}

function App() {
  useSessionRestore();
  useGameRewards();
  const phase = useGameStore((s) => s.phase);
  const versusPending = useGameStore((s) => s.versusPending);
  const modifierRevealPending = useGameStore((s) => s.modifierRevealPending);
  const viewingGame = useGameStore((s) => s.viewingGame);
  const initProfile = useProfile((s) => s.init);
  const ready = useProfile((s) => s.ready);
  const signedIn = useProfile(selectIsSignedIn);
  const userId = useProfile((s) => s.userId);
  const displayName = useProfile((s) => s.displayName);
  const accountChecked = useProfile((s) => s.accountChecked);
  const startOpeningCampaign = useGameStore((s) => s.startOpeningCampaign);
  const [showAccount, setShowAccount] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [dailyBonus, setDailyBonus] = useState(0);
  const loginBonusClaimed = useRef(false);
  // Session-only: a signed-out visitor sees the landing on every fresh load, but
  // can choose to continue as a guest for the rest of this session.
  const [guestContinued, setGuestContinued] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>('mode-select');
  const [tutorialSource, setTutorialSource] = useState<TutorialSource>('menu');
  const [shopSource, setShopSource] = useState<ShopSource>('menu');
  const appOpenTracked = useRef(false);

  useEffect(() => { void initProfile(); }, [initProfile]);

  // Apply saved accessibility prefs (reduce-motion / colorblind palette) to the
  // document as early as possible so the very first render already reflects them.
  useEffect(() => { applyAppearancePrefs(); }, []);

  // Once-per-day login bonus: a small Campaign Funds chest the first time a signed-in
  // player opens the app each UTC day. Server-gated + idempotent, so calling on every
  // sign-in is safe; the ref keeps it to one attempt per session. Distinct from the
  // Daily Race and the finish streak.
  useEffect(() => {
    if (!signedIn) { loginBonusClaimed.current = false; return; }
    if (!userId || loginBonusClaimed.current) return;
    loginBonusClaimed.current = true;
    void useProfile.getState().claimDailyLoginBonus().then((amount) => {
      if (amount > 0) {
        setDailyBonus(amount);
        track('funds_earned', { amount, source: 'login_bonus', claimed: true, game_mode: 'menu' });
      }
    });
  }, [signedIn, userId]);

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

  // Android hardware/gesture back mirrors the on-screen ← buttons. Modals
  // (AuthGate, Settings) register their own handlers on top of this one, so
  // back closes them first. At Home this is null: no sentinel exists and the
  // system backgrounds the app, which is correct Android behavior.
  const inGame = viewingGame && phase !== 'SETUP' && phase !== 'MENU';
  const multiplayerMode = useGameStore((s) => s.multiplayerMode);
  const minimizeGame = useGameStore((s) => s.minimizeGame);
  let backAction: (() => void) | null = null;
  if (inGame) {
    // Online games and the election tally swallow back: leaving mid-turn would
    // abandon opponents, and a minimized tally has no Resume CTA to return to.
    // Solo/local games minimize straight to Home (not the setup screen that
    // launched them) — Home's Resume Campaign CTA re-enters the game.
    const canMinimize = multiplayerMode !== 'online' && phase !== 'ELECTION_TALLY';
    backAction = canMinimize
      ? () => { minimizeGame(); setAppMode('mode-select'); }
      : () => {};
  } else if (ready && (signedIn || guestContinued)) {
    if (appMode === 'tutorial') {
      backAction = tutorialSource === 'menu' ? () => setAppMode('mode-select') : null;
    } else if (appMode !== 'mode-select') {
      backAction = () => setAppMode('mode-select');
    }
  }
  useAndroidBack(backAction);

  function openAccount(trigger: 'account_button' | 'shop_gate' | 'online_gate' | 'other' = 'account_button') {
    track('account_prompt_opened', { trigger });
    setShowAccount(true);
  }

  function startPracticeGame() {
    setGuestContinued(true);
    setAppMode('bot');
    startOpeningCampaign();
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
  const account = showAccount ? (
    <AuthGate
      onClose={() => setShowAccount(false)}
      onViewLeaderboard={() => { setShowAccount(false); setAppMode('leaderboard'); }}
    />
  ) : null;
  const settings = showSettings ? (
    <Settings
      onClose={() => setShowSettings(false)}
      onOpenAccount={() => openAccount('account_button')}
    />
  ) : null;

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
    // Start-of-game intros, in order: matchup → modifier roll → board.
    if (versusPending) {
      screen = <VersusScreen />;
      screenKey = 'versus';
    } else if (modifierRevealPending) {
      screen = <ModifierRoll />;
      screenKey = 'modroll';
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
        <HomeAudioControls />
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
    // Browsable signed-out so the store (and its in-app purchases) is discoverable
    // from a clean install — Shop handles guest state itself and prompts sign-in
    // on buy/unlock attempts via onSignIn.
    screen = (
      <Shop
        source={shopSource}
        onBack={() => setAppMode('mode-select')}
        onSignIn={() => openAccount('shop_gate')}
        onOpenSeason={() => setAppMode('season')}
      />
    );
    screenKey = 'shop';
  } else if (appMode === 'play') {
    screen = (
      <PlayModeSelect
        onSelect={selectMode}
        onBack={() => setAppMode('mode-select')}
      />
    );
    screenKey = 'play';
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
  } else if (appMode === 'leaderboard') {
    screen = signedIn ? (
      <Leaderboard onBack={() => setAppMode('mode-select')} />
    ) : (
      <GuestGate
        title="Ranks"
        message="Sign in to see where you rank against players worldwide."
        onBack={() => setAppMode('mode-select')}
        onSignIn={() => openAccount('other')}
      />
    );
    screenKey = 'leaderboard';
  } else if (appMode === 'season') {
    screen = signedIn ? (
      <SeasonPass onBack={() => setAppMode('mode-select')} />
    ) : (
      <GuestGate
        title="Season"
        message="Sign in to earn Season XP, claim rewards, and unlock the Campaign Trail."
        onBack={() => setAppMode('mode-select')}
        onSignIn={() => openAccount('other')}
      />
    );
    screenKey = 'season';
  } else {
    screen = (
      <ModeSelect
        onSelect={selectMode}
        onTutorial={openTutorial}
        onAccount={() => openAccount('account_button')}
        onSettings={() => setShowSettings(true)}
        onOpeningCampaign={() => {
          setGuestContinued(true);
          startOpeningCampaign();
        }}
      />
    );
    screenKey = 'menu';
  }

  return (
    <>
      <ScreenTransition screenKey={screenKey}>{screen}</ScreenTransition>
      <ActiveModifierChip />
      {account}
      {settings}
      {dailyBonus > 0 && screenKey === 'menu' && (
        <DailyBonusChest amount={dailyBonus} onClose={() => setDailyBonus(0)} />
      )}
    </>
  );
}

export default App;
