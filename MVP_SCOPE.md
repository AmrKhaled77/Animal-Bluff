# Animal Bluff — MVP Scope

**Purpose:** define delivery priority for the first playable online release. This scope does not alter the official rules in [`GAME_RULES.md`](./GAME_RULES.md) or approve different gameplay. Approved features deferred to a later release remain part of the product design.

Animal Bluff is the browser-based online multiplayer version of the classic Ravensburger _You're Bluffing!_ / _Kuhhandel_ base game.

## 1. Architecture and hosting direction

- Monorepo managed with npm workspaces.
- Frontend: Next.js and TypeScript in `apps/web`.
- Backend: Node.js, TypeScript, and Colyseus in `apps/server`.
- Shared contracts and utilities in `packages/shared`.
- Database: PostgreSQL, accessed through Prisma.
- Redis is deferred and is not required for the MVP. Docker is not required for the current development setup.
- Gameplay is server-authoritative. The server controls cards, ownership, money, turns, timers, transactions, scoring, and results. It validates every action; clients cannot directly change authoritative state.
- Hosting direction: the frontend can be deployed to Vercel, the Colyseus backend needs persistent Node.js hosting, and PostgreSQL may use a managed host later.

## 2. MVP — Required for the first playable release

### Rooms, identity, and lobby

- Guest play without accounts or passwords; room creation/join, nicknames and avatars, unique player IDs, reconnect behavior, and host assignment as specified in [`DIGITAL_RULES.md`](./DIGITAL_RULES.md).
- Create and join rooms using never-reused server-generated room codes.
- A 3–5 player lobby with Ready states, host transfer, host-only kick/close controls, confirmation, and lobby lock after accepted Start Game.
- 30-minute unstarted-room expiry, 60-second reconnection and forfeiture, available slots, hostless-room behavior, Start Game/expiry ordering, and setup-failure recovery as specified in `DIGITAL_RULES.md`.
- Server revalidation of all match-start conditions.

### Match setup and gameplay

- Server-side random first-player selection and internal audit event.
- Atomic shuffle and dealing with unique money-card IDs and no partial setup on failure.
- Complete classic match flow using `GAME_RULES.md`: auctions, bidding and payment, Donkey distributions, Kuhhandel, quartet completion, and official scoring. No variants or custom game settings.
- Approved timing and transitions: 15-second auctions, 15-second auctioneer first-purchase choice, 30-second payment selection, and 30-second Kuhhandel response, including the approved disconnect and exact-deadline handling in `DIGITAL_RULES.md`.
- Public submitted Kuhhandel cards and transfers; ordinary money hands remain private except for submitted negotiation cards and the approved failed-payment reveal. Successful auction-payment denominations remain private.
- Approved disconnect/reconnect and forfeiture behavior for setup, auctions, payment, and negotiation. Do not invent behavior for remaining open questions.
- Animal Collection with official animal order and values, card grouping, completed-quartet state, and current ownership.
- Match ending, unchanged official score formula, shared victory for equal highest scores, and Game Over results.

### Records and player-facing product

- Public Game Log with server timestamps, processing order, and player/event filters. It includes all public Kuhhandel details and may record failed payments and repeat auctions, but never retains or reproduces money-card denominations shown in the live failed-payment reveal. Successful auction payment entries show the paid amount but not the selected denominations. A standalone Match Replay is not part of the MVP.
- Results and basic Match Statistics. Statistics do not affect scoring.
- Responsive Arabic and English web UI for desktop and mobile browsers.
- Home, join/create, lobby, Game Starting, game board, auction, Kuhhandel, payment, collection, and results screens.
- A complete bilingual **How to Play** page with official values, illustrations, examples, and scoring.
- No interactive tutorial in the MVP.

### Security and reliability

- Server-authoritative game state and validation for every action and transition.
- Unique card and transaction IDs, atomic transfers/dealing, duplicate-request protection, and rate limiting.
- Private money hands except for explicit public rules, and an internal immutable Audit Log distinct from the Public Game Log. The Audit Log records room and match lifecycle events; player join, leave, reconnect, and forfeiture; host transfers; auction, payment, and negotiation outcomes; rejected requests with reasons; and server errors/exceptions. It is not exposed to ordinary players and never records reconnect tokens, secrets, or sensitive authentication data.
- Reconnect-token storage follows the approved raw-token choice documented in `DIGITAL_RULES.md`. Database exposure could reveal valid tokens; review this security risk before production deployment. Never write tokens, secrets, or sensitive authentication data to logs.
- Temporary data cleanup according to the room lifecycle; no permanent match history.

## 3. Later enhancements

- PWA installation experience; no separate native Android or iOS app is planned for the first release.
- Interactive five-step tutorial, Skip Tutorial, and replay from Settings.
- A standalone, read-only Match Replay with player/event filters, based only on public events and subject to the privacy and retention rules in `DIGITAL_RULES.md`.
- Extended Match Statistics beyond the basic result and match summary.
- Cosmetic frames and colors.
- Advanced animations, sound, and visual polish. The MVP still needs clear state changes and usable feedback.

## 4. Scope rules

- Deferring a feature does not invalidate or change an approved game mechanic or design decision.
- The Public Game Log remains an MVP feature; detailed Kuhhandel disclosure is critical and cannot be deferred.
- A later Match Replay is a view over public events and must follow the privacy and retention rules in `DIGITAL_RULES.md`.
- MVP scoring remains exactly `QuartetValueSum × QuartetCount`; money is not scored, and equal highest scores share victory.
- Implement approved behaviors exactly. Do not silently choose outcomes for open questions in `DIGITAL_RULES.md`.

## 5. Open questions for implementation planning

Use the **Open Questions and Production Risk** section of [`DIGITAL_RULES.md`](./DIGITAL_RULES.md) as the single source for unresolved gameplay, presentation, and production-security details. The raw reconnect-token storage choice is approved, but its security risk must be reconsidered before production deployment.
