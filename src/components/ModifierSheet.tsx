/**
 * ModifierSheet — renders a candidate's asymmetric modifier sheet.
 *   affinities      → COST modifiers (positive = cheaper, negative = penalty)
 *   payoutModifiers → PROFIT modifiers (positive = extra, negative = reduction)
 */

interface ModifierSheetProps {
  affinities: Record<string, number>;
  payoutModifiers: Record<string, number>;
  compact?: boolean;
}

function pct(v: number): string {
  return `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;
}

function Group({ title, tone, items }: {
  title: string;
  tone: 'good' | 'bad';
  items: [string, number][];
}) {
  if (items.length === 0) return null;
  return (
    <div className={`mod-sheet__group mod-sheet__group--${tone}`}>
      <div className="mod-sheet__group-title">{title}</div>
      <ul className="mod-sheet__list">
        {items.map(([g, v]) => (
          <li key={g}>
            <span className="mod-sheet__g">{g}</span>
            <span className="mod-sheet__v">{pct(v)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ModifierSheet({ affinities, payoutModifiers, compact }: ModifierSheetProps) {
  const aff = Object.entries(affinities);
  const pay = Object.entries(payoutModifiers);

  const costReductions = aff.filter(([, v]) => v > 0);
  const costPenalties = aff.filter(([, v]) => v < 0);
  const extraProfit = pay.filter(([, v]) => v > 0);
  const profitCuts = pay.filter(([, v]) => v < 0);

  const neutral =
    costReductions.length + costPenalties.length + extraProfit.length + profitCuts.length === 0;

  return (
    <div className={`mod-sheet${compact ? ' mod-sheet--compact' : ''}`}>
      {neutral && <div className="mod-sheet__neutral">Neutral — no modifiers</div>}
      <Group title="Cheaper buy-in" tone="good" items={costReductions} />
      <Group title="Extra profit" tone="good" items={extraProfit} />
      <Group title="Costs more" tone="bad" items={costPenalties} />
      <Group title="Lower payout" tone="bad" items={profitCuts} />
    </div>
  );
}
