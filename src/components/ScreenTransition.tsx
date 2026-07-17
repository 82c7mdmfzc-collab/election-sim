import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motionReduced } from '../utils/appearance';

/**
 * ScreenTransition — directional push/pop between top-level screens, so
 * navigation feels like a native app pushing/popping views instead of a web
 * SPA hard-cutting between routes.
 *
 * Direction comes from a depth map over screenKeys: navigating deeper plays a
 * push (new screen slides in from the right while the old one slides out
 * left), navigating shallower plays the reverse pop. Screens outside the map
 * — the boot flow and the phase-coupled game screens — keep the plain enter
 * fade and are NEVER held mounted as an exit layer: game screens assume
 * store-phase invariants that may no longer hold once the key changes.
 *
 * The exit layer is the previous commit's element. Only nav-tier screens
 * (total functions of app state, safe to render under any store state) can
 * become one, it is inert (aria-hidden + pointer-events:none via CSS), and it
 * is reaped by a timer rather than animationend, which is unreliable when
 * reduce-motion clamps durations mid-flight or the tab is backgrounded.
 *
 * At rest the DOM is a plain position:relative stage with one static child
 * whose animation ended at transform:none — no containing block is left
 * behind for the game shell's fixed-position overlays (the stage is only
 * position:fixed while `.is-animating`).
 */

const EXIT_MS = 240; // keep in sync with --dur-screen-exit (08-native-game.css)

type Dir = 'push' | 'pop' | 'fade';

// Navigation depth per screenKey. menu is the root; unlisted keys (splash,
// landing, username, update-required, game, versus, modroll, tally, gameover)
// always take the fade tier — see the safety note above.
const DEPTH: Record<string, number> = {
  menu: 0,
  play: 1, shop: 1, daily: 1, online: 1, leaderboard: 1, season: 1, tutorial: 1,
  bot: 2, single: 2,
};

// Semantic exceptions to the depth heuristic.
const EDGE_OVERRIDES: Record<string, Dir> = {
  'single>shop': 'push', // locked-candidate upsell reads as forward nav
};

function resolveDir(from: string, to: string): Dir {
  const override = EDGE_OVERRIDES[`${from}>${to}`];
  if (override) return override;
  const df = DEPTH[from];
  const dt = DEPTH[to];
  if (df === undefined || dt === undefined) return 'fade';
  return dt >= df ? 'push' : 'pop';
}

interface Layer { key: string; node: ReactNode; dir: Dir }

export function ScreenTransition({ screenKey, children }: {
  screenKey: string;
  children: ReactNode;
}) {
  // Last committed screen. Navigation state is derived in a layout effect so
  // React never reads mutable refs during render and the transition is still
  // prepared before the browser paints the new screen.
  const last = useRef<{ key: string; node: ReactNode }>({ key: screenKey, node: children });
  const [enterDir, setEnterDir] = useState<Dir>('fade');
  const [exiting, setExiting] = useState<Layer | null>(null);

  useLayoutEffect(() => {
    const previous = last.current;
    if (screenKey !== previous.key) {
      const dir = resolveDir(previous.key, screenKey);
      setEnterDir(dir);
      setExiting(
        dir !== 'fade' && !motionReduced()
          ? { key: previous.key, node: previous.node, dir }
          : null,
      );
    }
    last.current = { key: screenKey, node: children };
  }, [children, screenKey]);

  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(() => setExiting(null), EXIT_MS + 40);
    return () => window.clearTimeout(t);
  }, [exiting]);

  return (
    <div className={`screen-stage${exiting ? ' is-animating' : ''}`}>
      {exiting && (
        <div className={`screen-layer screen-layer--exit-${exiting.dir}`} aria-hidden>
          {exiting.node}
        </div>
      )}
      <div key={screenKey} className={`screen-layer screen-layer--enter-${enterDir}`}>
        {children}
      </div>
    </div>
  );
}
