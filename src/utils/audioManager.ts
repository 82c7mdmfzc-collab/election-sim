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

// NOTE: click/confirm/quit are WAV, not OGG. iOS WKWebView cannot decode Ogg
// Vorbis at all (neither <audio> playback nor Web Audio decodeAudioData), so
// those three SFX were silent on device. WAV/LPCM is decodable everywhere —
// iOS, every desktop browser, and Web Audio — and the clips are tiny (<0.06s).
const MANIFEST: Record<string, string> = {
  click:             '/sounds/click.wav',
  tick:              '/sounds/tick.mp3',
  clash:             '/sounds/clash.mp3',
  confirm:           '/sounds/confirm.wav',
  quit:              '/sounds/quit.wav',
  victory:           '/sounds/victory.mp3',
  buy:               '/sounds/buy.mp3',
  income:            '/sounds/income.mp3',
  dominate:          '/sounds/dominate.mp3',
  election_warning:  '/sounds/election_warning.mp3',
  round_end:         '/sounds/round_end.mp3',
  music:             '/sounds/music.mp3',
};

// The looping background-music track id.
const MUSIC_TRACK = 'music';
// Sound IDs treated as background music (looped); everything else is SFX.
const MUSIC_IDS = new Set([MUSIC_TRACK]);

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
  private musicVolume = 0.3; // 0–1
  // Desired background-music state. The looping track is reconciled against this
  // flag (plus the mute/volume gates) by _syncMusic(), so unmuting or raising the
  // volume from zero resumes playback instead of leaving it silently stopped.
  private musicWanted = false;
  // Web Audio graph for the music track. On iOS WKWebView, HTMLMediaElement.volume
  // is read-only — assignments are silently ignored and it always reports 1.0 — so
  // setting node.volume can't change loudness on device, leaving the music dial dead
  // and the track at full blast. Routing the music element through a GainNode is the
  // supported workaround (GainNode.gain IS honored on iOS), so the dial and the
  // default volume actually take effect. Built lazily the first time music plays:
  // createMediaElementSource can only be called once per element, and the
  // AudioContext starts suspended until resumed after a user gesture. The context is
  // shared with the SFX graph below.
  private audioCtx: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private musicGraphReady = false;
  // Web Audio graph for SFX. SFX hit the SAME read-only-volume wall as music on iOS:
  // cloned <audio> elements always play at full blast there. So when the init() probe
  // finds element.volume isn't honored, SFX are played as decoded AudioBuffers through
  // a shared GainNode (gain IS honored) instead of cloned elements. Web/desktop, where
  // element.volume works, keep the simpler clone path untouched (sfxVolumeHonored stays
  // true). Buffers are decoded once and cached; each play spins up a fresh source node
  // so overlapping triggers don't cut each other short.
  private sfxGain: GainNode | null = null;
  private readonly sfxBuffers = new Map<string, AudioBuffer>();
  private readonly sfxDecoding = new Set<string>();
  private sfxVolumeHonored = true;

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

    // Probe whether HTMLMediaElement.volume assignments actually stick. iOS
    // WKWebView ignores them (the property is read-only and always reports 1.0),
    // so on that platform SFX volume must be applied via Web Audio gain instead.
    try {
      const probe = new Audio();
      probe.volume = 0.5;
      this.sfxVolumeHonored = Math.abs(probe.volume - 0.5) < 0.01;
    } catch {
      this.sfxVolumeHonored = true;
    }
    // On the Web Audio SFX path, decode the buffers up front so the very first
    // play already has volume control. decodeAudioData works on a still-suspended
    // context, so this is safe before the first user gesture.
    if (!this.sfxVolumeHonored) {
      this._ensureSfxGain();
      for (const id of Object.keys(MANIFEST)) {
        if (!MUSIC_IDS.has(id)) this._decodeSfx(id);
      }
    }

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
        this._resumeCtx();
        for (const node of this.looping.values()) node.play().catch(() => {});
      }
    });
  }

  /**
   * Lazily build the Web Audio graph for the music track:
   * musicEl → MediaElementSource → GainNode → destination. Volume is controlled
   * via the gain (honored on iOS, unlike element.volume), so the element's own
   * volume is pinned to unity to avoid double-attenuation. Best-effort: if Web
   * Audio is unavailable or the element was already wired, we fall back to
   * element.volume (which still works on web/desktop).
   */
  /**
   * Create (once) the AudioContext shared by the music and SFX graphs. Returns
   * null if Web Audio is unavailable. On iOS the context starts suspended and is
   * resumed by _resumeCtx() after the first user gesture / on foreground.
   */
  private _ensureCtx(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    try {
      const Ctx = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.audioCtx = new Ctx();
    } catch {
      this.audioCtx = null;
    }
    return this.audioCtx;
  }

  private _ensureMusicGraph(): void {
    if (this.musicGraphReady) return;
    this.musicGraphReady = true; // attempt once regardless of outcome
    const node = this.sounds.get(MUSIC_TRACK);
    if (!node) return;
    const ctx = this._ensureCtx();
    if (!ctx) return;
    try {
      const source = ctx.createMediaElementSource(node);
      this.musicGain = ctx.createGain();
      this.musicGain.gain.value = this.musicVolume;
      source.connect(this.musicGain).connect(ctx.destination);
      node.volume = 1; // gain is now authoritative
    } catch {
      // createMediaElementSource throws if already called for this element, and
      // the constructor can throw in locked-down webviews. Fall back to
      // element.volume (works on web/desktop); leave the shared ctx for SFX.
      this.musicGain = null;
    }
  }

  /** Create (once) the SFX gain node on the shared context. Null if Web Audio is unavailable. */
  private _ensureSfxGain(): GainNode | null {
    if (this.sfxGain) return this.sfxGain;
    const ctx = this._ensureCtx();
    if (!ctx) return null;
    try {
      this.sfxGain = ctx.createGain();
      this.sfxGain.gain.value = this.sfxVolume;
      this.sfxGain.connect(ctx.destination);
    } catch {
      this.sfxGain = null;
    }
    return this.sfxGain;
  }

  /** Fetch + decode one SFX into a cached AudioBuffer (no-op if cached or already in flight). */
  private _decodeSfx(soundId: string): void {
    if (this.sfxBuffers.has(soundId) || this.sfxDecoding.has(soundId)) return;
    const ctx = this._ensureCtx();
    const path = MANIFEST[soundId];
    if (!ctx || !path) return;
    this.sfxDecoding.add(soundId);
    fetch(path)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => { this.sfxBuffers.set(soundId, decoded); })
      .catch(() => {})
      .finally(() => { this.sfxDecoding.delete(soundId); });
  }

  /** Play a decoded SFX through the gain node. Returns false if it isn't decoded yet / unavailable. */
  private _playSfxBuffer(soundId: string): boolean {
    const gain = this._ensureSfxGain(); // may create the shared ctx; read it after
    const ctx = this.audioCtx;
    const buffer = this.sfxBuffers.get(soundId);
    if (!ctx || !gain || !buffer) return false;
    try {
      gain.gain.value = this.sfxVolume; // pick up live volume changes
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start();
      return true;
    } catch {
      return false;
    }
  }

  /** Resume the (iOS-suspended) AudioContext after a user gesture / foreground. */
  private _resumeCtx(): void {
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
  }

  /** Apply the current music volume through the gain node (iOS) and the element. */
  private _applyMusicVolume(): void {
    if (this.musicGain) this.musicGain.gain.value = this.musicVolume;
    else {
      const node = this.sounds.get(MUSIC_TRACK);
      if (node) node.volume = this.musicVolume;
    }
  }

  /** Retry any loop plays that were blocked by autoplay policy. */
  private _unlockPending(): void {
    this._resumeCtx();
    for (const id of [...this.pendingLoops]) {
      this.pendingLoops.delete(id);
      // Music reconciles through _syncMusic so it uses the gain graph, not
      // element.volume; any other looped sound replays directly.
      if (id === MUSIC_TRACK) this._syncMusic();
      else this.play(id, true);
    }
  }

  /** Global mute. When muted, play() is a no-op and any looping tracks stop. */
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (muted) {
      for (const id of [...this.looping.keys()]) this.stop(id);
    }
    // Resume background music when global mute is lifted (if it's still wanted).
    this._syncMusic();
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
    // Pause when muted, resume when unmuted — reconciled against the wanted flag.
    this._syncMusic();
  }

  isMusicMuted(): boolean {
    return this.musicMuted;
  }

  /** Set music volume 0–1. Applies immediately and starts/stops the loop at the 0 boundary. Does NOT change the muted flag. */
  setMusicVolume(v: number): void {
    this.musicVolume = Math.max(0, Math.min(1, v));
    // Applies the new volume to a live loop, and starts/stops it when crossing 0.
    this._syncMusic();
  }

  /**
   * Request background music to play. Idempotent: safe to call on every app
   * mount. Honors the mute/volume gates and the browser autoplay policy (the
   * loop is queued and retried on first user interaction if autoplay is blocked).
   */
  startMusic(): void {
    this.musicWanted = true;
    this._syncMusic();
  }

  /** Stop background music and clear the wanted flag so it won't auto-resume. */
  stopMusic(): void {
    this.musicWanted = false;
    this.stop(MUSIC_TRACK);
  }

  /**
   * Reconcile the looping music track against the desired state. Resumes from the
   * current position rather than restarting, applies the live volume, and queues
   * for autoplay-unlock retry if the browser blocks playback.
   */
  private _syncMusic(): void {
    const node = this.sounds.get(MUSIC_TRACK);
    if (!node) return;
    const shouldPlay =
      this.musicWanted && !this.muted && !this.musicMuted && this.musicVolume > 0;
    if (shouldPlay) {
      this._ensureMusicGraph();
      node.loop = true;
      this._applyMusicVolume();
      if (!this.looping.has(MUSIC_TRACK)) {
        this._resumeCtx();
        // Mark as looping optimistically; clear it if autoplay is blocked so the
        // first user gesture re-runs _syncMusic and actually starts playback.
        this.looping.set(MUSIC_TRACK, node);
        node.play().catch(() => {
          this.looping.delete(MUSIC_TRACK);
          this.pendingLoops.add(MUSIC_TRACK);
        });
      }
    } else {
      this.pendingLoops.delete(MUSIC_TRACK);
      if (this.looping.has(MUSIC_TRACK)) {
        node.pause();
        this.looping.delete(MUSIC_TRACK);
      }
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
      // Where element.volume is read-only (iOS WKWebView), play SFX through the
      // Web Audio gain graph so the volume dial actually takes effect. Falls back
      // to a cloned element if the buffer isn't decoded yet (first play of a sound)
      // or Web Audio is unavailable.
      if (!this.sfxVolumeHonored) {
        this._resumeCtx();
        if (this._playSfxBuffer(soundId)) return;
        this._decodeSfx(soundId); // warm the cache for next time
      }
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
