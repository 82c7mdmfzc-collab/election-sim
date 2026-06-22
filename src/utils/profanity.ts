/**
 * profanity — username content filter for Apple Guideline 1.2 (objectionable
 * user-generated content). Usernames are the only user content shown to other
 * players, so we reject offensive ones at claim time. A matching server-side
 * trigger (supabase/moderation.sql) enforces the same list as defense-in-depth;
 * keep BLOCKED_ROOTS in sync between the two.
 *
 * Matching is on a normalized form: lowercased, common leetspeak folded back to
 * letters, and all non-letters stripped — so "f_u_c_k", "fvck", "@ss" etc. are
 * still caught. Roots are matched as substrings (catches embedded slurs).
 */

const LEET: Record<string, string> = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's', '!': 'i', '|': 'i',
};

/** Lowercase, fold leetspeak, drop everything that isn't a–z. */
export function normalizeForProfanity(input: string): string {
  return input
    .toLowerCase()
    .split('')
    .map((ch) => LEET[ch] ?? ch)
    .join('')
    .replace(/[^a-z]/g, '');
}

// Curated list of clearly-offensive roots (slurs + strong profanity). Substring
// match on the normalized name. Intentionally conservative to limit the
// Scunthorpe problem while catching the content Apple review flags.
const BLOCKED_ROOTS: readonly string[] = [
  'nigger', 'nigga', 'faggot', 'retard', 'chink', 'spic', 'kike', 'wetback',
  'tranny', 'coon', 'dyke', 'paki', 'gook',
  'rape', 'rapist', 'molest', 'pedophile', 'pedo', 'incest', 'nazi', 'hitler',
  'cunt', 'fuck', 'shit', 'bitch', 'whore', 'slut', 'wank', 'bastard',
  'cock', 'dick', 'pussy', 'penis', 'vagina', 'boner', 'cum', 'jizz',
  'anus', 'asshole', 'dildo', 'porn', 'pornhub', 'sex', 'tits', 'titties',
  'bollocks', 'twat', 'arsehole',
];

/** True if the username contains banned content and must be rejected. */
export function containsProfanity(name: string): boolean {
  const n = normalizeForProfanity(name);
  if (!n) return false;
  return BLOCKED_ROOTS.some((root) => n.includes(root));
}
