/**
 * sanitize — defense-in-depth cleaning for user-entered free text (display
 * names) before it enters shared game state and is broadcast to other players.
 *
 * React already escapes text on render, so this is belt-and-suspenders: it
 * strips control characters and angle brackets, collapses whitespace, and caps
 * length so a malicious or accidental payload can't reach another client's UI.
 *
 * Implemented as a char-code scan (no control-char regex) to keep the source
 * plain ASCII and lint-clean.
 *
 * In addition to control chars and angle brackets, this blocks specific
 * dangerous invisibles that survive React's escaping and can be used to spoof or
 * hide content in another player's UI:
 *   - bidi overrides/embeds (U+202A–U+202E, U+2066–U+2069) — reverse/hide text
 *   - zero-width chars (U+200B–U+200D, U+FEFF) — invisible joiners/obfuscation
 */

const BLOCKED_CODEPOINTS = new Set<number>([
  0x200b, 0x200c, 0x200d, 0xfeff,             // zero-width space/joiners/BOM
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,     // bidi embeddings + overrides
  0x2066, 0x2067, 0x2068, 0x2069,             // bidi isolates
]);

export function sanitizeName(raw: string, maxLen = 20): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;     // C0 control characters + DEL
    if (code >= 0x80 && code <= 0x9f) continue;     // C1 control characters
    if (BLOCKED_CODEPOINTS.has(code)) continue;     // bidi / zero-width invisibles
    if (ch === '<' || ch === '>') continue;         // angle brackets
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
