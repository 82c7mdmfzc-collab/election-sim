/**
 * Portrait — renders a candidate's image, falling back to their text initials
 * if the image is missing or fails to load. Lets premium characters ship before
 * their art lands (e.g. Joe Biden / Ronald Reagan) without showing broken images.
 */

import { useState } from 'react';

interface PortraitProps {
  src: string;
  /** Initials shown when the image is unavailable. */
  initials: string;
  name: string;
  className?: string;
}

export function Portrait({ src, initials, name, className = '' }: PortraitProps) {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <span className={`portrait-fallback ${className}`.trim()} aria-label={name} role="img">
        {initials}
      </span>
    );
  }

  return (
    <img
      className={className}
      src={src}
      alt={name}
      draggable={false}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}
