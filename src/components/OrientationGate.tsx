import { useEffect, useState } from 'react';

/**
 * Full-screen "rotate your device" gate. Elector is landscape-only.
 *
 * We block ONLY touch / coarse-pointer devices held in portrait — desktop and
 * laptop users (fine pointer) are never gated, even in a narrow window. On
 * installed/fullscreen PWAs that support it we also best-effort lock the native
 * orientation; everywhere else this overlay is the enforcement.
 */
function isBlockedPortrait(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  return coarse && portrait;
}

type LockableOrientation = ScreenOrientation & {
  lock?: (orientation: string) => Promise<void>;
};

export function OrientationGate() {
  const [blocked, setBlocked] = useState(isBlockedPortrait);

  useEffect(() => {
    const update = () => setBlocked(isBlockedPortrait());
    const mq = window.matchMedia('(orientation: portrait)');
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);

    // Best-effort native lock (no-ops / rejects where unsupported — that's fine).
    const orientation = screen.orientation as LockableOrientation | undefined;
    orientation?.lock?.('landscape').catch(() => {});

    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  if (!blocked) return null;

  return (
    <div className="orient-gate" role="dialog" aria-modal="true" aria-label="Rotate your device">
      <div className="orient-gate__inner">
        <div className="orient-gate__phone" aria-hidden>
          <svg viewBox="0 0 80 80" width="84" height="84" fill="none">
            <rect x="26" y="10" width="28" height="50" rx="5" stroke="currentColor" strokeWidth="3" />
            <line x1="36" y1="15" x2="44" y2="15" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path
              d="M14 64 a26 26 0 0 1 26 -26"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
            />
            <path d="M40 33 l4 9 l-9 -2 z" fill="currentColor" />
          </svg>
        </div>
        <h2 className="orient-gate__title">Rotate your device</h2>
        <p className="orient-gate__text">
          Elector is built for landscape. Turn your device sideways to keep playing.
        </p>
      </div>
    </div>
  );
}
