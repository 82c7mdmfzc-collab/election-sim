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
 */

export function sanitizeName(raw: string, maxLen = 20): string {
  let out = '';
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue; // control characters
    if (ch === '<' || ch === '>') continue;     // angle brackets
    out += ch;
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, maxLen);
}
