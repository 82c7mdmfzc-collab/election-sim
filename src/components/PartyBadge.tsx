/**
 * PartyBadge — a small pill showing a candidate's party (cosmetic).
 * Colored by party: Republican red · Democrat blue · Independent green.
 */

import { PARTY_LABEL, type Party } from '../game/candidates';

export function PartyBadge({ party, className = '' }: { party: Party; className?: string }) {
  return (
    <span className={`party-badge party-badge--${party} ${className}`.trim()}>
      <span className="party-badge__dot" aria-hidden />
      {PARTY_LABEL[party]}
    </span>
  );
}
