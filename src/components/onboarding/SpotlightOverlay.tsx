/**
 * SpotlightOverlay — a dimming scrim with a rounded cutout over the current
 * anchor, plus a tip card. The scrim/cutout are pointer-events:none so the
 * player interacts with the highlighted element directly; only the tip card
 * (Skip / Continue) is interactive. Reduced motion drops the pulse.
 */

import type { OnboardingStep } from './steps';
import { isReducedMotion } from '../../utils/localPrefs';

export interface Rect { left: number; top: number; width: number; height: number; }

export function SpotlightOverlay({ step, rect, index, total, onContinue, onSkip }: {
  step: OnboardingStep;
  /** Anchor rect in viewport coords, or null for a centered card. */
  rect: Rect | null;
  index: number;
  total: number;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const reduced = isReducedMotion();
  const pad = 8;
  const cut = rect
    ? { x: rect.left - pad, y: rect.top - pad, w: rect.width + pad * 2, h: rect.height + pad * 2 }
    : null;

  // Card sits opposite the anchor's vertical half so it never covers it; a
  // rect-less step centers the card.
  const anchorBelowMid = rect ? rect.top + rect.height / 2 > window.innerHeight / 2 : false;
  const cardPos = !rect ? 'center' : anchorBelowMid ? 'top' : 'bottom';
  const skippable = step.skippable !== false && index > 0;

  return (
    <div className="tut-overlay" role="dialog" aria-modal="false" aria-label={step.title}>
      {/* SVG scrim with a punched-out hole around the anchor. */}
      <svg className="tut-scrim" width="100%" height="100%" aria-hidden>
        <defs>
          <mask id="tut-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {cut && (
              <rect x={cut.x} y={cut.y} width={cut.w} height={cut.h} rx="14" ry="14" fill="black" />
            )}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" fill="rgba(4,9,20,0.66)" mask="url(#tut-mask)" />
      </svg>

      {/* Glowing ring tracing the cutout. */}
      {cut && (
        <div
          className={`tut-ring${reduced ? '' : ' tut-ring--pulse'}`}
          style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }}
          aria-hidden
        />
      )}

      <div className={`tut-card tut-card--${cardPos}`}>
        <div className="tut-card__dots" aria-hidden>
          {Array.from({ length: total }).map((_, i) => (
            <span key={i} className={`tut-card__dot${i === index ? ' is-active' : i < index ? ' is-done' : ''}`} />
          ))}
        </div>
        <h3 className="tut-card__title">{step.title}</h3>
        <p className="tut-card__body">{step.body}</p>
        <div className="tut-card__actions">
          {skippable && (
            <button type="button" className="tut-card__skip" onClick={onSkip}>Skip guide</button>
          )}
          {step.cta && (
            <button type="button" className="tut-card__cta btn-cta" onClick={onContinue}>{step.cta}</button>
          )}
        </div>
      </div>
    </div>
  );
}
