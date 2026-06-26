/**
 * ModifierSheet — renders a candidate's asymmetric modifier sheet.
 *   affinities      → COST modifiers (positive = cheaper, negative = penalty)
 *   payoutModifiers → PROFIT modifiers (positive = extra, negative = reduction)
 */

interface ModifierSheetProps {
  affinities: Record<string, number>;
  payoutModifiers: Record<string, number>;
  compact?: boolean;
  /** 'list' (default) stacks every group; 'columns' splits the good groups into a
   *  "Bonus" column and the bad groups into a "Penalty" column, like the stats popup. */
  layout?: 'list' | 'columns';
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

export function ModifierSheet({ affinities, payoutModifiers, compact, layout = 'list' }: ModifierSheetProps) {
  const aff = Object.entries(affinities);
  const pay = Object.entries(payoutModifiers);

  const costReductions = aff.filter(([, v]) => v > 0);
  const costPenalties = aff.filter(([, v]) => v < 0);
  const extraProfit = pay.filter(([, v]) => v > 0);
  const profitCuts = pay.filter(([, v]) => v < 0);

  const goodCount = costReductions.length + extraProfit.length;
  const badCount = costPenalties.length + profitCuts.length;
  const neutral = goodCount + badCount === 0;

  if (layout === 'columns') {
    return (
      <div className="mod-sheet mod-sheet--columns">
        {neutral && <div className="mod-sheet__neutral">Neutral — no modifiers</div>}
        {!neutral && (
          <>
            <div className="mod-sheet__col mod-sheet__col--good">
              <div className="mod-sheet__col-head mod-sheet__col-head--good">Bonus</div>
              {goodCount === 0 && <div className="mod-sheet__empty">No bonuses</div>}
              <Group title="Cheaper buy-in" tone="good" items={costReductions} />
              <Group title="Extra profit" tone="good" items={extraProfit} />
            </div>
            <div className="mod-sheet__col mod-sheet__col--bad">
              <div className="mod-sheet__col-head mod-sheet__col-head--bad">Penalty</div>
              {badCount === 0 && <div className="mod-sheet__empty">No penalties</div>}
              <Group title="Costs more" tone="bad" items={costPenalties} />
              <Group title="Lower payout" tone="bad" items={profitCuts} />
            </div>
          </>
        )}
      </div>
    );
  }

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
