# Differentiation Pass — Historical Notes

This document is an archive of an earlier naming/copy pass. It is not the current source of truth for economy values or launch instructions.

Current player-facing naming conventions:

| Concept | Current player-facing language |
| --- | --- |
| State progress | Influence Levels |
| Permanent state lock | Secured / called in contextual copy |
| Simultaneous spend failure | Campaign Collision |
| State group economy | Coalitions / Coalition Reserves |
| National side tracks | National Groups / National Networks depending on surface |
| Flexible spend currency inside a match | National cash / War Chest depending on surface |
| Persistent meta-currency | Campaign Funds |
| Shop | Campaign Store / Store |
| Daily mode | Daily Race |
| Help/tutorial | Campaign Guide |
| Local hot-seat | Local |

Current economy facts:

- Base per-turn national income is `250` in `src/game/config.ts`.
- Bobby Tooley is free, starts with 300, and has no synergies.
- Free candidates: Tooley, Trump, Harris, Lincoln, Joe Biden.
- Paid candidates: Reagan, Washington, Starmer, JFK at 4,500 Funds; Farage at 10,000 Funds.
- Cosmetics are live Funds sinks: priced share frames and victory messages at 3,000 Funds each.

Current differentiation risks worth revisiting later:

- The core simultaneous hidden allocation structure is central gameplay and cannot be copy-edited away.
- State EV weights and the 270 target are real Electoral College facts.
- The influence-track visual language could be made more distinctive in a future UI pass.
- Original coalition artwork and stronger election-night commentary would improve brand distinctiveness.

Use `ELECTOR_GAME_BRIEF.md` for current game/economy numbers.
