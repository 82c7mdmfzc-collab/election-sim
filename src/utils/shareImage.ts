/**
 * Share-card rendering + sharing pipeline.
 *
 *   build props → renderToStaticMarkup(<ShareCard/>) → SVG string
 *   → svgToPngBlob() (draw SVG onto a canvas, export PNG)
 *   → sharePng() (Web Share with files, else download + copy link)
 *
 * SVG → PNG via canvas keeps this dependency-free and robust in mobile / Tauri
 * webviews (no html-to-image, no tainted canvas — the SVG is fully inline).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ShareCard,
  SHARE_CARD_W,
  SHARE_CARD_H,
  SHARE_CARD_PORTRAIT_W,
  SHARE_CARD_PORTRAIT_H,
  type ShareCardProps,
  type ShareCardVariant,
} from '../components/ShareCard';

/** Footer hook generated from the final result. */
export function shareLine(winnerName: string | null, ev: number): string {
  if (!winnerName) return 'A hung Electoral College — nobody reached 270.';
  return `${winnerName} swept to ${ev} electoral votes. Think you can do better?`;
}

export interface DramaticInput {
  winnerName: string | null;
  /** States the owner locked permanently. */
  secured: number;
  /** Coalitions the owner dominated at game end. */
  coalitions: number;
  /** Optional standout clash state name. */
  biggestClashState?: string | null;
}

/** A punchy one-liner for the share card, derived from the final standings. Pure + testable. */
export function dramaticEvent({ winnerName, secured, coalitions, biggestClashState }: DramaticInput): string {
  if (!winnerName) return 'No majority — a hung Electoral College';
  const parts: string[] = [];
  if (secured > 0) parts.push(`🔒 ${secured} ${secured === 1 ? 'state' : 'states'} secured`);
  if (coalitions > 0) parts.push(`🏛 ${coalitions} ${coalitions === 1 ? 'coalition' : 'coalitions'}`);
  if (biggestClashState) parts.push(`⚔ ${biggestClashState} clash`);
  return parts.length ? parts.join(' · ') : 'Wire-to-wire to 270';
}

/** Pixel dimensions for a card variant (feed straight into svgToPngBlob). */
export function shareCardDims(variant: ShareCardVariant): { width: number; height: number } {
  return variant === 'portrait'
    ? { width: SHARE_CARD_PORTRAIT_W, height: SHARE_CARD_PORTRAIT_H }
    : { width: SHARE_CARD_W, height: SHARE_CARD_H };
}

export function renderShareCardSvg(props: ShareCardProps): string {
  return renderToStaticMarkup(createElement(ShareCard, props));
}

/** Rasterize an inline SVG string to a PNG Blob at 2× for crisp social previews. */
export async function svgToPngBlob(
  svg: string,
  width = SHARE_CARD_W,
  height = SHARE_CARD_H,
  scale = 2,
): Promise<Blob> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('share-card SVG failed to load'));
    img.src = url;
  });

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('share-card: no 2d canvas context');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('share-card: toBlob returned null'))), 'image/png');
  });
}

export interface SharePayload {
  blob: Blob;
  filename: string;
  title: string;
  text: string;
  url: string;
}

export type ShareOutcome = 'shared' | 'downloaded';

/**
 * Share the PNG natively (iOS Safari / Android Chrome support files), else fall
 * back to a download + copying the text+link to the clipboard.
 */
export async function sharePng({ blob, filename, title, text, url }: SharePayload): Promise<ShareOutcome> {
  const file = new File([blob], filename, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };

  if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title, text, url });
      return 'shared';
    } catch (err) {
      // User dismissed the sheet — treat as success, don't double-prompt a download.
      if (err instanceof DOMException && err.name === 'AbortError') return 'shared';
      // Any other failure: fall through to the download path below.
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);

  try {
    await navigator.clipboard?.writeText(`${text} ${url}`);
  } catch {
    /* clipboard may be unavailable / denied — non-fatal */
  }
  return 'downloaded';
}
