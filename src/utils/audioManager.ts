/**
 * AudioManager — zero-dependency singleton audio engine.
 *
 * Lives outside the React component lifecycle so it is never garbage-collected
 * on component unmount. This prevents mid-clip interruption when components
 * re-render or unmount during gameplay.
 *
 * play(id)          — clones the preloaded node so rapid overlapping calls
 *                     (e.g. fast pip clicks) don't cut each other short.
 * play(id, true)    — uses the canonical node and sets loop=true so the track
 *                     cycles seamlessly; call stop(id) to end it.
 * stop(id)          — pauses and resets the looping track.
 * init()            — preloads all sounds into browser memory (call once on
 *                     app startup, before the first user interaction).
 */

import { haptic, type HapticKind } from './haptics';
import { isSfxMuted, isMusicMuted, getSfxVolume, getMusicVolume } from './localPrefs';

const MANIFEST: Record<string, string> = {
  click:             '/sounds/click.ogg',
  tick:              '/sounds/tick.mp3',
  clash:             '/sounds/clash.mp3',
  confirm:           '/sounds/confirm.ogg',
  quit:              '/sounds/quit.ogg',
  victory:           '/sounds/victory.mp3',
  buy:               '/sounds/buy.mp3',
  income:            '/sounds/income.mp3',
  dominate:          '/sounds/dominate.mp3',
  election_warning:  '/sounds/election_warning.mp3',
  round_end:         '/sounds/round_end.mp3',
  music:             '/sounds/music.mp3',
};

// Sound IDs treated as background music (looped); everything else is SFX.
const MUSIC_IDS = new Set(['music']);

// Each discrete sound effect maps to a haptic, so every existing
// AudioManager.play() call site also produces tactile feedback on supported
// devices (no-op on web). 'tick' (the per-second turn timer) is intentionally
// omitted so the device doesn't buzz once a second.
const HAPTICS: Record<string, HapticKind> = {
  click: 'selection',
  confirm: 'medium',
  clash: 'medium',
  buy: 'success',
  victory: 'success',
  dominate: 'heavy',
  income: 'selection',
  election_warning: 'warning',
  round_end: 'light',
  quit: 'light',
};

class _AudioManager {
  private readonly sounds = new Map<string, HTMLAudioElement>();
  // Tracks the active looping instance for each soundId so stop() can target it.
  private readonly looping = new Map<string, HTMLAudioElement>();
  // Last time each non-looping soundId fired, so a global click handler and an
  // explicit play() of the same sound collapse into one instead of doubling up.
  private readonly lastPlayed = new Map<string, number>();
  // Loop plays that were blocked by autoplay policy; retried on first user interaction.
  private readonly pendingLoops = new Set<string>();
  private muted = false;
  private sfxMuted = false;
  private musicMuted = false;
  private sfxVolume = 0.8;   // 0–1
  private musicVolume = 0.6; // 0–1

  init(): void {
    for (const [id, path] of Object.entries(MANIFEST)) {
      if (this.sounds.has(id)) continue;
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.load();
      this.sounds.set(id, audio);
    }
    // Restore per-category mute + volume from persisted prefs.
    this.sfxMuted = isSfxMuted();
    this.musicMuted = isMusicMuted();
    this.sfxVolume = getSfxVolume() / 100;
    this.musicVolume = getMusicVolume() / 100;

    // Retry any loop that was blocked by the browser/WKWebView autoplay policy.
    // Both click and touchstart are registered so the first real gesture (mouse
    // OR touch) unlocks audio even if the other event never fires.
    const unlock = () => { this._unlockPending(); };
    document.addEventListener('click', unlock, { once: true, capture: true });
    document.addEventListener('touchstart', unlock, { once: true, capture: true });

    // Pause loops when the app is backgrounded on iOS (WKWebView doesn't auto-pause
    // HTML audio), resume when foregrounded again.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        for (const node of this.looping.values()) node.pause();
      } else {
        for (const node of this.looping.values()) node.play().catch(() => {});
      }
    });
  }

  /** Retry any loop plays that were blocked by autoplay policy. */
  private _unlockPending(): void {
    for (const id of [...this.pendingLoops]) {
      this.pendingLoops.delete(id);
      this.play(id, true);
    }
  }

  /** Global mute. When muted, play() is a no-op and any looping tracks stop. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      for (const id of [...this.looping.keys()]) this.stop(id);
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setSfxMuted(v: boolean): void {
    this.sfxMuted = v;
  }

  isSfxMuted(): boolean {
    return this.sfxMuted;
  }

  /** Set SFX volume 0–1. Does NOT change the muted flag. */
  setSfxVolume(v: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, v));
  }

  setMusicMuted(v: boolean): void {
    this.musicMuted = v;
    if (v) {
      for (const id of [...this.looping.keys()]) {
        if (MUSIC_IDS.has(id)) this.stop(id);
      }
    }
  }

  isMusicMuted(): boolean {
    return this.musicMuted;
  }

  /** Set music volume 0–1. Applies immediately to any playing loop. Does NOT change the muted flag. */
  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    for (const [id, node] of this.looping.entries()) {
      if (MUSIC_IDS.has(id)) node.volume = this.musicVolume;
    }
  }

  play(soundId: string, loop = false): void {
    if (this.muted) return;
    const isMusic = MUSIC_IDS.has(soundId);
    if (isMusic && (this.musicMuted || this.musicVolume === 0)) return;
    if (!isMusic && (this.sfxMuted || this.sfxVolume === 0)) return;
    const src = this.sounds.get(soundId);
    if (!src) return;

    if (loop) {
      // Reuse the canonical node for looping so stop() always finds it.
      src.loop = true;
      src.volume = this.musicVolume;
      src.currentTime = 0;
      src.play().catch(() => {
        // Autoplay blocked (browser policy or WKWebView restriction before first
        // user interaction). Queue for retry on the next click/touchstart.
        this.pendingLoops.add(soundId);
      });
      this.looping.set(soundId, src);
    } else {
      // Collapse duplicate triggers (e.g. global click handler + an explicit
      // play('click') on the same button) that land within a short window.
      const now = performance.now();
      if (now - (this.lastPlayed.get(soundId) ?? -Infinity) < 80) return;
      this.lastPlayed.set(soundId, now);
      // Fire the matching haptic alongside the sound (no-op on web; gated by the
      // same mute check above, so muting audio also silences haptics).
      const hapticKind = HAPTICS[soundId];
      if (hapticKind) haptic(hapticKind);
      // Clone so simultaneous rapid clicks don't interrupt each other.
      const clone = src.cloneNode() as HTMLAudioElement;
      clone.volume = this.sfxVolume;
      clone.play().catch(() => {});
    }
  }

  stop(soundId: string): void {
    this.pendingLoops.delete(soundId);
    const node = this.looping.get(soundId) ?? this.sounds.get(soundId);
    if (!node) return;
    node.pause();
    node.currentTime = 0;
    node.loop = false;
    this.looping.delete(soundId);
  }
}

export const AudioManager = new _AudioManager();
