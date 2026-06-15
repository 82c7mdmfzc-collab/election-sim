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
};

class _AudioManager {
  private readonly sounds = new Map<string, HTMLAudioElement>();
  // Tracks the active looping instance for each soundId so stop() can target it.
  private readonly looping = new Map<string, HTMLAudioElement>();
  // Last time each non-looping soundId fired, so a global click handler and an
  // explicit play() of the same sound collapse into one instead of doubling up.
  private readonly lastPlayed = new Map<string, number>();
  private muted = false;

  init(): void {
    for (const [id, path] of Object.entries(MANIFEST)) {
      if (this.sounds.has(id)) continue;
      const audio = new Audio(path);
      audio.preload = 'auto';
      audio.load();
      this.sounds.set(id, audio);
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

  play(soundId: string, loop = false): void {
    if (this.muted) return;
    const src = this.sounds.get(soundId);
    if (!src) return;

    if (loop) {
      // Reuse the canonical node for looping so stop() always finds it.
      src.loop = true;
      src.currentTime = 0;
      src.play().catch(() => {/* autoplay policy — silently ignore */});
      this.looping.set(soundId, src);
    } else {
      // Collapse duplicate triggers (e.g. global click handler + an explicit
      // play('click') on the same button) that land within a short window.
      const now = performance.now();
      if (now - (this.lastPlayed.get(soundId) ?? -Infinity) < 80) return;
      this.lastPlayed.set(soundId, now);
      // Clone so simultaneous rapid clicks don't interrupt each other.
      const clone = src.cloneNode() as HTMLAudioElement;
      clone.play().catch(() => {});
    }
  }

  stop(soundId: string): void {
    const node = this.looping.get(soundId) ?? this.sounds.get(soundId);
    if (!node) return;
    node.pause();
    node.currentTime = 0;
    node.loop = false;
    this.looping.delete(soundId);
  }
}

export const AudioManager = new _AudioManager();
