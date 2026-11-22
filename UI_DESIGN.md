# Animal Bluff — UI Design

**Status:** approved user-interface and experience decisions for the online multiplayer game.

## 1. Relationship to the rules

[`GAME_RULES.md`](./GAME_RULES.md) defines the official physical game rules. [`DIGITAL_RULES.md`](./DIGITAL_RULES.md) defines the approved online adaptations, server behavior, and remaining unresolved cases. This document specifies how approved behavior is presented; it does not add game mechanics.

Submitted Kuhhandel offers are public to everyone in the room after submission. A player's money hand is otherwise private except when the failed-auction procedure requires its reveal. The physical game's hidden-offer presentation does not apply to the online UI after submission.

## 2. Home and joining

- The main menu offers **Create Room** and **Join Room**.
- Before creating or joining, a player chooses a nickname and a built-in animal avatar.
- Nicknames are 3–16 characters and allow Arabic and English letters, numbers, and spaces. Reject empty or whitespace-only names, disallowed symbols, and HTML/code input; the server's validation is authoritative. A profanity filter is not required.
- Nicknames are unique within a room and may be reused in other rooms. Avatars are selected from the built-in animal collection, with no duplicate avatar in the same room.
- Nickname and avatar may be changed before the match starts and are fixed afterward.
- **Create Room** creates a room, assigns its creator as host, and displays the server-generated room code. **Join Room** accepts a room code.
- The join flow accepts manual room-code entry and reports whether a room is invalid, full, already started, expired, or inaccessible.
- Show the room code with a **Copy** control and an invite link with **Copy** and **Share** controls. An invite link opens the join page with the room code prefilled. The host can show or hide a QR code. The QR code encodes only the invite link and room code, never player identity or reconnect credentials.
- No account registration or password is required.

## 3. Lobby

Use a player-list layout rather than arranging avatars around a table. Each player card shows:

- Animal avatar and nickname.
- Host marker.
- Connection state.
- Ready or Not Ready state.
- After the 60-second lobby reconnection window expires, keep the player's nickname and avatar visible with a clear **Forfeited / Permanently Left** indicator. Mark their slot as available; a replacement guest receives a separate identity and new data, never the old player's identity or cards.

Lobby behavior and controls:

- Every player, including the host, must press **Ready**. New players start Not Ready.
- The host can start only with 3–5 eligible connected players, all Ready. The host sees which players are unready or disconnected, and the names preventing a start.
- A nickname or avatar change does not reset Ready.
- On disconnect, Ready immediately becomes Not Ready. A player who reconnects within 60 seconds keeps their identity, nickname, and avatar but must press Ready again.
- The server checks player count, connection eligibility, readiness, and host authority again when Start Game is requested. If fewer than 3 eligible players remain, Start Game is disabled.
- The host has **Kick Player** and **Close Room** controls. Both require confirmation and are available only in the lobby. A kicked player sees `You were removed from this room` and cannot use the old identity, but may rejoin the same open lobby as a new guest with a new identity, no old permissions or game data, and Not Ready state.
- Confirming **Close Room** deletes it immediately and broadcasts `The host closed this room` to everyone in it.
- Host departure triggers the `joinOrder` transfer rules in `DIGITAL_RULES.md`. If no eligible connected player exists, the hostless timer allows a new guest to become host unless an older eligible player is connected. After the server accepts Start Game, Leave Room, Kick, and Close Room controls are locked.
- The lobby expires 30 minutes after room creation if no match starts. Player joins do not reset the timer. Starting the match cancels it. The UI must not imply that the timer restarts after a join.
- If setup fails and the lobby is restored, continue the original expiration timer with its remaining time; do not restart it.
- A room code is never reused. New players cannot join after the match starts. If a player leaves before Start Game is accepted, the server treats it as a disconnect and rechecks start requirements.

## 4. Game Starting screen

Show:

- Player names and turn order.
- The first player selected by the server.
- The status text `Shuffling cards and dealing...`.

Dealing is atomic on the server. If setup fails, return everyone to the lobby, retain their pre-setup Ready states, continue the original lobby-expiration timer with its remaining time, and show a clear error; never show partial card results. The host may retry immediately if requirements still hold. If a player reconnects during setup, continue; if they become Forfeited and at least 3 eligible players remain, continue setup. If fewer than 3 remain, cancel setup and return everyone to the lobby.

## 5. Game board layout

Use five main areas:

1. **Top bar:** room code, connection state, and active timer.
2. **Player list:** avatar, name, turn order, animal-card count, quartet count, connection status, and Forfeited status.
3. **Main play area:** current auction or Kuhhandel interface.
4. **Animal Collection.**
5. **Expandable Public Game Log.**

Highlight the current player and show a visible turn-start notice. The active player sees the legal **Start Auction** and/or **Start Kuhhandel** action; other players see a waiting state. Do not display another player's money card count, denominations, or total. Make the layout responsive on desktop and mobile.

The MVP Public Game Log is chronological, oldest to newest, uses server timestamps, is immutable to players, and can be filtered by player and event type. Simultaneous events follow server processing order. It records room/match events, turn starts, auctions and first-purchase choices, payment summaries, failed payments and repeat auctions, public Kuhhandel submissions and outcomes, transfers, quartet completions, and disconnects/reconnects. Successful auction payments show the amount but not selected denominations. Failed-payment card denominations are visible only during the live reveal and are never retained or reproduced in the Public Game Log or later-visible history. The log is retained during the match and for 10 minutes after any scored ending, then removed with the room. The no-connected-player ending has no result and follows the 60-second hostless deletion rule. The MVP has no standalone Match Replay screen; a read-only replay with player and event-type filters is deferred to a later release.

## 6. Auction UI

When an auction starts, show the animal image, name, printed quartet value, auctioneer, highest bid, and countdown. Display server-synchronized timer updates every second.

Bid controls:

- **Place Bid**, quick increments of +10, +20, +50, and +100, manual bid entry, and **Confirm Bid**.
- Show the minimum legal next bid. Send a bid only after confirmation.
- Show accepted bid history, newest first, and highlight the current high bid.
- The auctioneer cannot bid. A player may pass and bid again if another player raises the price while the auction remains open.
- The bidder sees their own money cards and total; other players do not see a hand during ordinary bidding. Only accepted bids appear in public history; rejected bids are omitted.
- At five seconds, show **Auction Ending Soon**, strengthen the timer indication, and play a short alert sound. An accepted bid resets the timer and removes the warning.
- The first valid bid processed by the server wins a simultaneous-bid race. The first auction bid may be any positive amount, including less than 10; every subsequent accepted bid must exceed the current high bid by at least 10. A valid bid received exactly at the timer deadline is accepted and resets the timer; after the deadline it is rejected.

When the auction closes:

- Show **Auction Finished**, the final bidder, and amount. If no one bid, show that the auctioneer receives the animal for free.
- If there was a bid, show the auctioneer's first-purchase choice: **Buy Animal** or **Let Winner Buy**. The choice has a 15-second timer. Pause it if the auctioneer disconnects; resume the remaining time on reconnect, or automatically pass if they become Forfeited. A valid choice received exactly at the deadline is accepted; no choice by expiry means pass.
- Other players see the first-purchase decision state, but not private payment details.
- Payment selection lasts 30 seconds and shows the payer's own cards, required amount, selected total, difference, and no-change warning. Require sufficient total and show a warning before confirmation. A valid confirmation received exactly at the deadline is accepted; after it is rejected.
- For a successful payment, never show the buyer's selected payment-card denominations to other players. The Public Game Log records the final amount paid only. If the high bidder fails payment, show the bidder's remaining money cards to everyone during the live reveal before the repeated auction, then remove that display; never retain the denominations in the Public Game Log or later-visible history. A forfeited disconnected high bidder's remaining hand is also revealed live before reauction.
- If the auctioneer's first-purchase payment fails, show that the attempt is cancelled and give the original high bidder a fresh 30-second chance to pay. If that bidder also fails, reveal their remaining hand and repeat the auction.
- Show **Payment Successful** after valid payment and a concise auction summary.

At auction close, start the original high bidder's 30-second payment timer immediately. If the Auctioneer chooses to buy, show that their timer is cancelled and the Auctioneer receives a fresh 30 seconds; if the Auctioneer passes or their choice timer expires, show that the high bidder continues with the time remaining on the original timer. If the Auctioneer's payment fails, show a fresh 30-second payment opportunity for the high bidder. While the high bidder remains the buyer, if their original timer expires first, reveal their hand live and repeat the auction; if their reconnection window expires first, mark them Forfeited, reveal their remaining hand, and repeat without them. If the Auctioneer's choice is paused by disconnection while the high bidder's timer expires or the bidder becomes Forfeited, keep the outcome open as specified in `DIGITAL_RULES.md`. If a player disconnects after payment selection has begun, pause that payer's active payment timer and resume it with the remaining time on reconnect.

## 7. Kuhhandel UI

The flow is:

1. Select an animal type.
2. Select an eligible target player.
3. The server determines the exact cards and quantity at stake.
4. The challenger manually selects money cards and sees their total privately before submission.
5. The challenger submits the offer. It cannot be edited or withdrawn afterward.
6. The challenged player chooses **Accept Offer** or **Counter Offer**. There is no Reject button. The target cannot edit the challenger's submitted offer.
7. For a counteroffer, the challenged player selects their own money cards and sees the total privately before submitting. That offer also cannot be edited or withdrawn.
8. The server compares offers and shows the final result to everyone.

If there is no eligible target, show **No Eligible Player**; do not start an offer or timer, consume no cards, and advance the turn. If the challenged player accepts the initial offer, do not show a comparison: transfer the animal cards to the challenger and the submitted money cards to the challenged player. If they counter, show the comparison and outcome after submission.

After an offer is submitted, every player sees the initiator, target, animal type, number of animal cards at stake, exact submitted money cards and total, accept/counter response, comparison, transfers, and cancellation reason if applicable. Submitted cards appear in the live view and MVP Public Game Log. A standalone Match Replay is deferred; if added later, it may show these same public negotiation details. Unsubmitted cards are not exposed by a Kuhhandel; the failed-auction hand reveal is a separate explicit exception.

Show a 30-second negotiation timer beginning after the initial offer is submitted. If the challenged player does not accept or counter by expiry, cancel without exchange, show the reason, and advance the turn. A valid Accept or Counter request received exactly at the deadline is accepted; after it is rejected. If a deal completes or is cancelled, show **Deal Completed** or **Deal Cancelled** and the cancellation reason. If a trader disconnects, pause the timer and preserve the exact stage for the 60-second reconnection window; on Forfeiture, cancel without transfers and advance the turn. Animate animal transfers and celebrate quartet completion.

## 8. Animal Collection presentation

- Show all ten animal types in fixed descending order by official value.
- Show card images, names, and count as `x/4`; show `0/4` for unowned types.
- Group matching cards; make each individual card distinguishable. Groups of two or three appear together.
- Completed quartets use a distinct visual state and remain visible until the match ends.
- Clicking a card opens its public acquisition history, including source and date/time; for Kuhhandel, show the previous owner.
- An animal card's acquisition source is **Auction** or **Kuhhandel** under `GAME_RULES.md`. A Donkey Bonus is a money distribution, not a way to acquire an animal card; show it as a money/Game Log event, not as an animal-card source.
- Show total animal cards and completed quartets separately. Update collections immediately after transfers.
- Keep the collection readable on mobile.

## 9. End Game and Results

The Game Over screen shows:

- Player ranking, avatar, nickname, completed quartet count, quartet value sum, final score, and calculation details.
- **Winner** or **Shared Victory**.
- Completed animals and a winner celebration.

The score display must use the official formula unchanged:

```text
Score = QuartetValueSum × QuartetCount
```

Stop gameplay interactions immediately after match end. After a scored match, players can choose **View Game Log**, **Match Statistics**, or **Back to Home**. A scored ending, including one because only one eligible player remains or no eligible player can take a legal turn, retains the room and results for 10 minutes. The no-connected-player ending records no win or loss and follows the 60-second hostless deletion rule, with no results screen.

## 10. Tutorial and How to Play

The full bilingual **How to Play** page is included in the MVP. The interactive five-step tutorial below is a later-release feature, not an MVP requirement. It covers:

1. Objective and collecting four matching animals.
2. Auctions and bidding.
3. Selecting payment cards.
4. Kuhhandel and negotiation.
5. Scoring and winning.

When the interactive tutorial is delivered, include **Skip Tutorial** and a way to replay it from Settings.

Provide a separate **How to Play** page from the main menu with complete base-game rules, all ten animal values, auction and negotiation illustrations, practical examples consistent with `GAME_RULES.md`, the scoring formula, and Arabic and English text. This page is an MVP feature.

## 11. Settings

Settings contain:

**Audio**

- Sound effects on/off, background music on/off, volume control, and notification sound controls independent of other effects.

**Language**

- Arabic and English, with immediate language change.

**Local profile**

- Nickname, avatar, and a free cosmetic frame or color. Settings profile changes apply to future rooms and matches; in-room nickname/avatar selection remains governed by the lobby rules.

**Help**

- Open How to Play in the MVP; add Replay Tutorial when the later-release interactive tutorial is delivered.

**Accessibility and motion**

- Text size controls, clear contrast, keyboard navigation on desktop, and no use of color alone to communicate state.
- Respect system reduced-motion preference and provide an in-game reduced-motion option.

Settings are stored locally and do not alter another player's local settings.

## 12. Notifications

Notify players when:

- Their turn begins.
- An auction is ending soon.
- A Kuhhandel offer arrives.
- A payment or negotiation deadline is approaching.
- A player disconnects or reconnects.
- A quartet completes.
- An important game event occurs.

Important notifications remain visible when sound is muted.

## 13. Visual identity and sound

Visual theme:

- Fun, warm, farm-inspired design using green, yellow, beige, and brown.
- Clear cartoon animal illustrations, large accessible buttons, and a simple non-distracting farm-inspired background.
- Modern interface; do not reproduce paper cards literally.

Animations cover animal draws and transfers, offer/counteroffer submission, timer and bid feedback, quartet completion, and winner celebration. Allow animations to be reduced or disabled.

Audio may include button clicks, bids, accept/counteroffer, auction completion, animal transfers, quartet completion, calm farm-inspired background music, and winner sound. Provide individual sound controls.

## 14. Compatibility

- Desktop browsers: Chrome, Edge, and Firefox.
- Mobile browsers: Android and iOS.
- Responsive layouts.
- PWA support is planned for a later update. No separate native Android or iOS application is planned for the first release.

## 15. UI details that remain undecided

Use [`DIGITAL_RULES.md`](./DIGITAL_RULES.md) as the source for the remaining open questions. The UI must reflect the approved bid, timer, payment, disclosure, and Game Log decisions in this document and must not invent outcomes for unresolved races: exact-deadline requests versus timer-expiration callbacks, conflicting action-timer expirations, or the high bidder's timer/forfeiture while the Auctioneer's choice is paused or a purchase is pending. These cases remain undecided in `DIGITAL_RULES.md`.

## Sources

- [`GAME_RULES.md`](./GAME_RULES.md) — official physical mechanics and scoring.
- [`DIGITAL_RULES.md`](./DIGITAL_RULES.md) — approved online behavior, public negotiation visibility, room rules, and unresolved details.
