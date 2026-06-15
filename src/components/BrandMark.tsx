import { useState } from 'react';

/** Elector brand mark — logo image with a styled-text fallback if art is absent. */
export function BrandMark() {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="brand">
      {!imgFailed ? (
        <img
          className="brand__logo"
          src="/assets/brand/elector_logo.png"
          alt="Elector"
          onError={() => setImgFailed(true)}
        />
      ) : (
        <div className="brand__wordmark">Elect<span className="brand__accent">o</span>r</div>
      )}
      <p className="brand__tagline">Win the Electoral College</p>
    </div>
  );
}
