/**
 * RotatingTip — a small, reusable "did you know" rotator for downtime surfaces
 * (online wait, hot-seat handoff, resolution ticker, loading splash).
 *
 * Pass a pool of tip strings; it cycles them on an interval. A random start
 * offset means two surfaces shown back-to-back don't repeat the same tip.
 */

import { useEffect, useState } from 'react';

interface RotatingTipProps {
  /** Tip strings to cycle through. */
  tips: readonly string[];
  /** Small uppercase label above the tip. Defaults to "Strategy tip". */
  label?: string;
  /** Rotation interval in ms. Defaults to 8000. */
  intervalMs?: number;
  /** Optional extra class on the root for surface-specific spacing. */
  className?: string;
}

export function RotatingTip({
  tips,
  label = 'Strategy tip',
  intervalMs = 8_000,
  className = '',
}: RotatingTipProps) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (tips.length <= 1) return;
    const id = window.setInterval(() => setI((n) => (n + 1) % tips.length), intervalMs);
    return () => clearInterval(id);
  }, [tips.length, intervalMs]);

  if (tips.length === 0) return null;

  return (
    <div className={`tip-rotator ${className}`.trim()} role="status" aria-live="polite">
      <span className="tip-rotator__label">{label}</span>
      <span key={i} className="tip-rotator__text">{tips[i % tips.length]}</span>
    </div>
  );
}
