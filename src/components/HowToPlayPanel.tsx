/**
 * HowToPlayPanel — a self-contained rules reference rendered from HOW_TO_PLAY.
 *
 * Shared by the in-game "?" help overlay (HelpButton) and the tutorial's recap
 * step, so the rules read identically everywhere and only need editing in one
 * place (src/game/tips.ts).
 */

import { HOW_TO_PLAY } from '../game/tips';

interface HowToPlayPanelProps {
  /** Optional dismiss handler — when present, renders a Close button. */
  onClose?: () => void;
  /** Heading text. Defaults to "How to Play". */
  title?: string;
}

export function HowToPlayPanel({ onClose, title = 'How to Play' }: HowToPlayPanelProps) {
  return (
    <div className="howto">
      <div className="howto__head">
        <h2 className="howto__title">{title}</h2>
        {onClose && (
          <button type="button" className="howto__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
      </div>
      <div className="howto__sections">
        {HOW_TO_PLAY.map((s) => (
          <section key={s.title} className="howto__section">
            <h3 className="howto__section-title">{s.title}</h3>
            <p className="howto__section-body">{s.body}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
