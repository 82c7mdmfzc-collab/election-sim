/**
 * Spinner — the shared loading indicator, replacing bare "Loading…" text so
 * async waits read as native app activity. Ring spinner in the gold accent;
 * falls back to a static ring under prefers-reduced-motion (see App.css).
 */

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <span className="spinner" role="status" aria-live="polite">
      <span className="spinner__ring" aria-hidden />
      <span className="spinner__label">{label}</span>
    </span>
  );
}
