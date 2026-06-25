/** Maps raw validatePurchase reason strings to short player-facing messages. */
export function friendlyAllocError(reason: string | undefined): string {
  if (!reason) return 'Purchase blocked';
  if (reason.startsWith('Insufficient national cash')) {
    return 'National groups only draw from your national treasury';
  }
  if (reason.startsWith('Insufficient funds')) {
    return 'Not enough campaign funds';
  }
  if (reason.startsWith('Entry gatekeeper')) {
    // e.g. "Entry gatekeeper: can only buy 3 rung(s) this turn (already queued 2)."
    const m = reason.match(/can only buy (\d+) rung/);
    const cap = m ? m[1] : '?';
    return `First-visit limit: max ${cap} rung(s) on first entry`;
  }
  if (reason.startsWith('Exceeds max rungs')) {
    return 'Already at max influence for this target';
  }
  return 'Purchase blocked';
}
