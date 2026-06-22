import { type ReactNode } from 'react';

/**
 * ScreenTransition — plays a short enter animation whenever the top-level screen
 * changes, so navigation feels like a native app pushing a new view instead of a
 * web SPA hard-cutting between routes.
 *
 * Implementation: keying the inner element on `screenKey` remounts it on every
 * change, which restarts the CSS enter animation (`.screen-transition` in
 * App.css; honors prefers-reduced-motion). The animation ends at transform:none,
 * so at rest it leaves no stacking/containing block behind for the many
 * fixed-position overlays inside the game shell.
 */
export function ScreenTransition({ screenKey, children }: {
  screenKey: string;
  children: ReactNode;
}) {
  return (
    <div className="screen-transition" key={screenKey}>
      {children}
    </div>
  );
}
