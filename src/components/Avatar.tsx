/**
 * Avatar — a circular character token with an optional cosmetic frame overlay.
 *
 * Composes the candidate token (via <Portrait>, which falls back to initials)
 * and an absolutely-positioned border image on top. The frame is purely
 * decorative (pointer-events:none) and hides itself if the art is missing, so
 * the token always renders cleanly. Size is driven by the wrapper's CSS box
 * (set a width/height on `className`); the frame and token fill it.
 */

import { useState } from 'react';
import { Portrait } from './Portrait';
import { borderImageUrl, DEFAULT_BORDER_ID } from '../game/borders';

interface AvatarProps {
  src: string;
  initials: string;
  name: string;
  /** Border/frame id; defaults to the free "classic" frame. Pass null for no frame. */
  borderId?: string | null;
  /** Class for the circular token image/fallback (sizing + border-radius live here). */
  className?: string;
  /** Optional extra class on the positioning wrapper. */
  wrapperClassName?: string;
}

export function Avatar({
  src,
  initials,
  name,
  borderId = DEFAULT_BORDER_ID,
  className = '',
  wrapperClassName = '',
}: AvatarProps) {
  const [frameFailed, setFrameFailed] = useState(false);
  const showFrame = !!borderId && !frameFailed;

  return (
    <span className={`avatar ${wrapperClassName}`.trim()}>
      <Portrait src={src} initials={initials} name={name} className={`avatar__token ${className}`.trim()} />
      {showFrame && (
        <img
          className="avatar__frame"
          src={borderImageUrl(borderId)}
          alt=""
          aria-hidden
          draggable={false}
          loading="lazy"
          decoding="async"
          onError={() => setFrameFailed(true)}
        />
      )}
    </span>
  );
}
