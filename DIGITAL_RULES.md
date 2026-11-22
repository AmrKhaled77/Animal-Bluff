# Animal Bluff — Digital Rules

**Status:** approved digital adaptations for the online multiplayer game.

## 1. Scope and relationship to the official rules

[`GAME_RULES.md`](./GAME_RULES.md) remains the reference for the original Ravensburger base-game rules, including cards, turn flow, auctions, Kuhhandel, quartet completion, and scoring. This document records only the approved adaptations for online play. It does not change the physical rules or scoring formula.

Where `GAME_RULES.md` describes an online choice as undecided, the decision recorded here is the approved project decision for the digital game. If any text appears to conflict, apply the official game rule for base-game play and this document only for the explicitly listed digital adaptations.

The physical rulebook keeps Kuhhandel offers face down and secretly counted. For the online game only, the approved public-negotiation rule in section 2.12 supersedes that offer-privacy behavior after submission. It does not make unsubmitted negotiation cards public; the separate failed-payment reveal in sections 2.4 and 2.11 is an explicit privacy exception.

## 2. Approved digital adaptations

### 2.1 Starting player

At match start, the server uniformly selects the first player once using Node.js `crypto.randomInt`. This is a digital adaptation of the physical rule that the player with the heaviest pet starts. The server records the selected player and timestamp in an internal audit log. Reconnection never changes turn order; later turns follow `GAME_RULES.md`.

### 2.2 Auction countdown and automatic closure

- Each auction has a **15-second countdown**.
- The countdown resets to **15 seconds** whenever the server accepts a valid new bid.
- Server time is authoritative. Clients receive timer updates every second. Apply the exact-deadline rule in section 2.17: a valid bid received at the deadline is accepted and resets the countdown to 15 seconds. If no valid bid is received by that deadline, the server closes the auction. The server does not pause the auction just because a bidder disconnects.
- At five seconds, the UI indicates that the auction is ending soon and plays a short alert (unless muted). A valid bid resets the countdown and clears this warning.
- Resolve the closed auction according to `GAME_RULES.md`, including its no-bid outcome and the auctioneer's right of first purchase.

### 2.3 Bid processing

If bids arrive simultaneously or nearly simultaneously, the first valid bid received and processed by the server is accepted. A later bid is accepted only if it satisfies the base game's minimum increase over the current high bid: at least 10 money units. Each accepted valid new bid resets the countdown; an invalid or insufficient increase does not. Apply the exact-deadline rule in section 2.17. The bidder may pass and may bid again if another player raises the price while the auction remains open.

The first auction bid may be any positive amount, including less than 10. Each subsequent accepted bid must be at least 10 higher than the current high bid. All other base-game restrictions remain in force, including that the auctioneer cannot bid and that a player in a repeated auction must not bid more than the value of the money they own. A disconnected player cannot submit bids.

After an auction closes with a bid, the auctioneer has **15 seconds** to choose whether to exercise the official right of first purchase. The digital choice is `Buy Animal` or `Let Winner Buy`; deadline handling follows section 2.17. This is the auctioneer's right under `GAME_RULES.md`, not a privilege of the room Host unless the same player happens to hold both roles. If the auctioneer disconnects during this choice, pause its timer and preserve the choice for the 60-second reconnection window. On reconnection, resume the remaining time. If the auctioneer becomes Forfeited, automatically pass. If there were no bids, apply the official free-animal outcome.

### 2.4 Payment selection

The player who must pay manually selects the money cards for the payment: the high bidder when they buy the animal, or the auctioneer when exercising the right of first purchase.

- Payment selection has a **30-second timer**. The UI shows the required amount, selected total, difference, and a no-change warning. The player can select and deselect cards freely before confirming. Confirmation is disabled if the selected total is insufficient; a warning appears before confirmation.
- The selected cards must total at least the required payment. Overpayment is allowed, all selected cards are transferred, and no change is returned. Once confirmed, payment cannot be undone.
- Server time is authoritative. Apply the exact-deadline rule in section 2.17. A warning appears during the final 10 seconds.
- If the original high bidder's payment selection expires, no cards or animals transfer. Reveal that bidder's remaining money cards and repeat the auction under the official failed-payment procedure. The bidder may participate in the repeat only if not Forfeited, and must not bid above the value of the money they own. If the auctioneer's first-purchase payment expires, cancel only that attempt and give the original high bidder a fresh 30-second payment opportunity; if that bidder also fails, reveal their remaining hand and repeat the auction. Repeat the official procedure again if a later payment also fails.
- The player may disconnect during payment selection. Pause the payment timer and preserve the transaction and selections; the 60-second reconnection timer runs independently. On reconnection, resume the remaining payment time. If the player becomes Forfeited, cancel the purchase without deduction or animal transfer; apply the relevant auction fallback or failed-payment rule in section 2.11.
- The server validates that selected cards belong to the payer, card IDs are unique, the transaction is open, and the total is sufficient. Invalid requests cause no change to card or animal ownership. Use unique transaction IDs. The first valid confirmation executes; duplicate requests must not transfer assets twice and may be rejected idempotently or return the existing transaction state. If the response to a successful payment was lost, return the existing transaction status rather than executing it again.
- If the auctioneer exercises first purchase but fails to pay for any reason, cancel only that attempt and give the original high bidder the payment opportunity. If the original bidder also fails, apply the official failed-payment procedure.

The full-hand reveal required by the official failed-payment procedure is an explicit exception to normal money-hand privacy. A failed bidder's hand is revealed before the repeat auction; the failed bidder may bid again up to the total value of their money cards unless they are Forfeited. A first-purchase attempt by the auctioneer instead follows the specific fallback above before any repeat auction.

### 2.5 Turns, match end, and final score ties

Use the official scoring formula unchanged:

```text
score = sum of completed quartet values × number of completed quartets
```

If multiple players share the highest final score, they share the victory. This shared victory is a digital adaptation because the official rules do not specify a score tie-break.

Turns proceed clockwise under `GAME_RULES.md`. At the start of a turn, show whose turn it is; the active player sees each currently legal action and other players see a waiting state. The server checks legal actions before each turn and skips a player with no legal action. If only two eligible players remain, play continues. If only one eligible player remains, or no eligible player can take a legal turn, end the match immediately and calculate scores using the official formula; do not automatically declare the sole remaining player the winner. If no players remain connected, use the separate no-eligible-host room-ending rule and record no win or loss.

### 2.6 Player identity

- Players join as guests. They do not register accounts or use passwords.
- The server assigns each player a unique player ID.
- Before creating or joining a room, each player chooses a nickname and a built-in animal avatar.
- Nicknames must be unique within the same room and may be reused in other rooms. The client validates 3–16 characters consisting of Arabic or English letters, numbers, and spaces and rejects blank names, disallowed symbols, and HTML/code input for usability; server validation is authoritative. A profanity filter is not required.
- Each room has no duplicate avatars. Nicknames and avatars may be changed before the match starts and are fixed once it starts. In the lobby, changing either does not reset Ready.
- A player reconnecting within the allowed window resumes the same identity, nickname, and avatar. A player returning after becoming Forfeited may join a lobby as a new guest with a new player ID, subject to ordinary room admission rules.

### 2.7 Room system

- A player can create a room; the server assigns a unique room code that is never reused. A room invite link carries the room code only. A QR code, when shown, encodes only that invite link and code, never player identity or reconnect credentials.
- Players with the room code may join before the match starts. The server rejects rooms that do not exist, are full, have started, have expired, or are inaccessible, and the UI reports the reason. New players cannot join after a match starts. A room has a maximum of 5 match slots; a match needs at least 3 eligible connected players to start. The first release has no custom game settings and uses the classic rules only.
- A lobby expires 30 minutes after room creation if no match has started. Joins do not reset this deadline. When the server accepts Start Game, it cancels the lobby-expiration timer.
- Server receipt/acceptance time decides a Start Game versus expiry race: if Start Game is accepted before expiry, cancel the timer and begin setup; if the room expires first, delete it and reject Start Game.
- If setup fails after Start Game was accepted and the lobby is restored, continue the original expiration timer using its remaining time. Do not restart the 30-minute timer. A successfully started match keeps the expiration timer cancelled.
- If fewer than 3 eligible players remain in a lobby, Start Game is disabled and the room remains until its original 30-minute expiration, except for the no-eligible-host deletion path below.
- Every player, including the host, must be Ready to start. New players are Not Ready. A disconnection immediately sets Ready to Not Ready. Host start conditions are checked again by the server when Start Game is requested.
- Only the host can kick a player or close the room, and both actions require confirmation. These actions are available only in the lobby. Closing immediately deletes the room and broadcasts `The host closed this room`; a closed room cannot be recovered or rejoined.
- A kicked player is told `You were removed from this room` and cannot reconnect with the old identity. They may join the same room again as a new guest with a new player ID and reconnect token, no old permissions or game data, and Not Ready status, if the lobby is still open and has capacity.
- Before Start Game is accepted, a player who leaves is handled as a normal disconnect and the server rechecks start requirements. Once Start Game is accepted, reject Leave Room, Kick, and Close Room requests and lock lobby management.

#### Host Assignment and Transfer

- Each player receives an incrementing `joinOrder` the first time they join a room. On reconnection, the player keeps their original `joinOrder`.
- The player who creates the room becomes its host automatically. If the host disconnects or is marked as forfeited, the server transfers host privileges to the connected, non-forfeited player with the smallest `joinOrder`. A player marked as forfeited is not eligible to become host.
- A host who leaves a room without closing it immediately transfers host privileges under the same `joinOrder` rule.
- A successor receives the same existing host permissions; a transfer does not add powers.
- If host privileges have already transferred to a successor, the former host does not automatically regain them; the new host remains the host.
- If there is no connected, eligible player to receive host privileges, the room temporarily has no host and the server starts a **60-second wait**. During the wait, a newly joined guest is eligible to become host. If any earlier-joined eligible player is connected, that player takes priority by `joinOrder`; otherwise, the new guest becomes host. A returning player retains their original `joinOrder`; a new guest receives the next `joinOrder`.
- If no eligible player returns or joins within 60 seconds, the server ends the room and deletes its temporary data. If a match has started and no players are connected, the match ends without recording a win or loss for any player.
- This 60-second deletion path applies to a room ended under the no-eligible-host rule. The 10-minute post-match availability below applies to any scored match ending.

- Only the room host can start the match, and the host cannot start it with fewer than 3 players.

### 2.8 Disconnection and reconnection

- When a player disconnects, the server starts a **60-second reconnection window**. Server time is authoritative; apply the exact-deadline rule in section 2.17. Browser clocks are not authoritative.
- In a lobby, the disconnected player's Ready state becomes Not Ready immediately. If they reconnect within 60 seconds, they resume with the same player ID, nickname, and avatar, but must press Ready again.
- If a lobby player does not reconnect within 60 seconds, they become Forfeited and their slot becomes available for a new player. They may return to that lobby as a new guest with a new player ID and reconnect token, subject to capacity and the match-start join lock. A forfeited player's old token is invalid for that match.
- Keep a Forfeited lobby player's nickname and avatar visible with a clear `Forfeited` / permanently left indicator while their slot is available. A replacement guest receives a separate identity and new player data; never transfer or restore the Forfeited player's identity, cards, or other data to that guest.
- In an active match, a player who reconnects within 60 seconds resumes with their existing identity and game data. Reconnection does not change turn order. New players, including a forfeited player attempting to return as a new guest, cannot join an active match.
- If an active-match player does not reconnect within 60 seconds, they become Forfeited and the match continues without their actions.
- Do not automatically distribute or delete a forfeited player's money or animal cards. Those cards remain associated with that player.
- If a forfeited player owns the current normal turn, the server skips that turn and proceeds to the next eligible player. Forfeiture during an auction, payment, or Kuhhandel follows sections 2.11–2.12.

### 2.9 Post-match room lifecycle

- After a scored match ends, all players can view the final results. The no-connected-player ending has no result, as stated in section 2.15.
- After any scored match completion, including a match ended because no player is eligible for a legal turn, the room remains available for **10 minutes** so players can view results and public match records. The no-connected-player ending is the separate exception: it records no result and follows the 60-second hostless deletion rule.
- After those 10 minutes, the server deletes the room and its temporary data.
- To play another match, the host must create a new room; a completed room is not reused for another match.

### 2.10 Match setup and dealing

- The Game Starting screen shows the players, turn order, selected first player, and `Shuffling cards and dealing...`.
- The server shuffles the animal and money cards and deals the complete game state atomically: either every card is dealt to its intended location or none are. Failed setup must not leave partial or duplicate cards. On failure, restore everyone to the lobby and show a clear error; preserve each player's Ready state from before setup. The host may retry immediately if all start conditions still hold.
- If a player disconnects during setup, apply the normal 60-second reconnection rules. Continue when they reconnect. If they become Forfeited and at least 3 eligible players remain, continue setup; if fewer than 3 remain, cancel setup and return everyone to the lobby.
- Money cards are randomized server-side and have unique IDs. Each player can see only their own money cards, hand size, and total; other players cannot see another player's hand count, denominations, or total. The hand is displayed in denomination order: 0, 10, 50, 100, 200, 500.
- After dealing, each player receives a private `Your Starting Money` summary with the total value and card count. It disappears when the first turn begins; the player's own money hand and total remain visible to them.
- Reconnection does not alter the already selected turn order.

### 2.11 Auctions and payment edge cases

These rules supplement sections 2.2–2.4 and retain the official auction mechanics in `GAME_RULES.md`.

- A disconnected player cannot submit bids. If the accepted high bidder disconnects before the auction closes, their bid remains active. If they reconnect before close, show the current high bid, accepted bid history, and remaining auction time without resetting the auction timer.
- At auction close, start the original high bidder's **30-second payment timer immediately**, whether they are connected or not. It continues while they are disconnected. If they reconnect within 60 seconds, they have whatever time remains on that original timer.
- If the Auctioneer chooses `Buy Animal`, cancel the original high bidder's payment timer and start a fresh **30-second** payment timer for the Auctioneer. If the Auctioneer chooses `Let Winner Buy`, or their 15-second choice timer expires, the high bidder continues with the remaining time on their original timer; do not reset it.
- If the Auctioneer chooses to buy but fails to complete payment, cancel only that attempt and give the original high bidder a fresh full **30-second** payment opportunity. If the original high bidder also fails, reveal their remaining hand and repeat the auction under the official failed-payment procedure.
- If a high bidder's payment timer expires while they remain the buyer, cancel the purchase without transfers, reveal their remaining money cards, and repeat the auction under the official failed-payment procedure. If the bidder is connected and not Forfeited, they may bid in the repeated auction, capped at the total value of their money cards. A disconnected player cannot bid. If the 60-second reconnection window expires first, mark them Forfeited, cancel the purchase without transfers, reveal their remaining money cards, and repeat the auction; a Forfeited player cannot bid.
- If a player disconnects after payment selection has begun, pause that active payment timer and preserve its selections. The separate 60-second reconnection timer continues. On reconnect, resume with the remaining payment time. If the payer becomes Forfeited, cancel that purchase without deduction or animal transfer and follow the applicable fallback: an Auctioneer's first-purchase attempt passes to the original high bidder, while a high bidder's failed payment follows the reveal and reauction procedure.
- If the Auctioneer disconnects during the 15-second first-purchase choice, pause that choice timer while the 60-second reconnection window runs. On reconnect, resume the remaining choice time. If the Auctioneer becomes Forfeited, automatically pass; the high bidder continues with the remaining time on the original payment timer.
- If the original high bidder's payment timer expires while the Auctioneer's choice is paused by disconnection, or the high bidder is Forfeited after the Auctioneer has chosen to buy, the effects on the pending choice or sale are not specified. Do not invent a reset, cancellation, or payment transfer (section 3).

### 2.12 Kuhhandel mechanics and public disclosure

The following mechanics preserve `GAME_RULES.md`; the public visibility after submission is an online adaptation of the physical face-down offer procedure.

- On the challenger's turn, they choose an animal type first, then an eligible target who owns that type in an incomplete group. The server determines the exact animal cards and quantity under `GAME_RULES.md`; players cannot choose individual animal cards.
- If both players have at least two uncompleted cards of that type, the trade is for two cards from each. Otherwise, it is for one card from each as determined by the official pair/triple rules. Completed quartets are protected.
- A player may initiate at most one Kuhhandel per turn and may negotiate with the same player again on a later eligible turn. The target's turn is not consumed. When a deal completes or is cancelled, the current turn advances. If no eligible target exists, report `No Eligible Player`; no offer, timer, or card consumption occurs, and the turn advances.
- The negotiation timer is **30 seconds**, starting after the initial offer is submitted. If the challenged player does not accept or counter within that time, cancel the deal without exchange, show the cancellation reason, and advance the turn. Deadline handling follows section 2.17. A player cannot withdraw or edit a submitted offer. The challenged player may accept or submit a counteroffer, but cannot modify the original offer; there is no Reject action and no second tie round.
- If offers are equal, the original challenger gets the animal card(s); each player keeps the money received from the other, as in `GAME_RULES.md`.
- If the challenged player accepts the initial offer, no comparison is made: the challenger receives the eligible animal cards and the challenged player receives the submitted money cards. If the challenged player counters, compare the two totals; the higher offer wins the animal cards and each player keeps the money received from the other.
- After an offer is submitted, all players in the room see who initiated and who was targeted, the animal type and number of cards at stake, the exact money cards submitted and their total value, whether the target accepted or countered, the comparison, outcome, transfers, and any cancellation with its reason.
- Only money cards actually submitted into that negotiation become public. Other money cards stay private except when the separate failed-payment reveal applies. This applies to the live negotiation and Public Game Log; a later Match Replay must follow the same boundary.
- The two negotiating players' disconnection pauses the negotiation and preserves its exact state for up to 60 seconds. On reconnection, resume the same stage. If either becomes Forfeited, cancel the deal without transfers, show the reason, and advance the turn. An unrelated player's disconnection does not pause it.
- Server time is authoritative. Empty protocol requests and repeated requests do not extend deadlines. A valid zero-card or empty-hand offer remains legal under `GAME_RULES.md` and is not an empty protocol request. The first valid action received and processed by the server wins a concurrency race. Every transfer is atomic. Use unique transaction IDs for offers, acceptance, counteroffers, and transfers.

### 2.13 Public Game Log and later Match Replay

The Public Game Log includes, in chronological order:

- Turn starts and player names.
- Auction starts, accepted bids, winner, final amount, and outcome. Log the final amount paid, never the buyer's exact payment card denominations.
- Auctioneer first-purchase decisions and whether the right was exercised; successful payment summaries without payment-card denominations; failed-payment and repeat-auction events.
- All submitted Kuhhandel cards and values, comparisons, outcomes, transfers, cancellations, and cancellation reasons.
- Animal transfers and quartet completions.
- Player disconnects, reconnects, and important room or match events.

The server creates Game Log entries with server timestamps. They are immutable to players, filterable by player and event type, and simultaneous events are ordered by the server's processing sequence. The log is retained during a match and for 10 minutes after any scored ending, then deleted with the room. A no-connected-player ending has no result and follows the separate 60-second hostless deletion rule.

The live failed-payment reveal is not retained: do not store or reproduce the revealed money-card denominations in the Public Game Log or in any later-visible match history. The log may record that a payment failed and that a repeat auction began.

The MVP includes the Public Game Log only; it has player and event-type filters. A standalone Match Replay is deferred to a later release. If introduced, it is read-only, presents public events chronologically, includes public Kuhhandel details, supports player and event-type filters, and never reproduces denominations shown only during a failed-payment reveal. No permanent match history is kept; any later replay is deleted with the room.

### 2.14 Animal Collection

- Every player has an Animal Collection showing all ten animal types in fixed descending order by official quartet value. Unowned types show `0/4`; matching cards are grouped and groups of two or three remain together.
- Each animal card has a unique identifier or distinguishing marker. Players can open a group to inspect its individual cards. Completed quartets have a distinct completed state, remain visible until the match ends, and cannot be traded.
- Each card's public history shows acquisition date and time and its previous owner when obtained through Kuhhandel. Under the physical rules, an animal card is acquired by auction or Kuhhandel. A Donkey bonus is a money distribution, not a source of animal cards; record it as a money event rather than an animal-card acquisition source.
- Show total animal cards and completed quartets separately. Collections update immediately after transfers. Quartet completion triggers a short animation, sound, notification, and Game Log event.
- These animal ownership and history details are public.

### 2.15 Match ending, results, and statistics

- Natural completion remains as defined in `GAME_RULES.md`. If only one eligible player remains, or no eligible player can take a legal turn, the server ends the match and computes scores using the official formula; it does not automatically declare the sole remaining player the winner. A match ending because no players remain connected instead follows the no-eligible-host rule and records no win or loss.
- Stop all gameplay interactions immediately after the match ends. Show all players a Game Over screen with avatar, nickname, completed quartet count, quartet value sum, final score, ranking, and the calculation. Show Winner or Shared Victory, a visual celebration and winner sound (muted if sound is off), and completed animals.
- After a match, players can view the Public Game Log, Match Statistics, and return Home. Statistics include auctions participated in and won, Kuhhandel deals in which the player won animals, completed quartets, sum of quartet values, and match duration. Statistics never affect official scoring.
- The 10-minute post-match room retention in section 2.9 applies to scored endings, including an ending because no player is eligible for a legal turn. The no-connected-player ending has no result and follows its separate hostless deletion rule.

### 2.16 Security and privacy

- The server is authoritative. Never trust client-supplied game state; validate each bid, offer, payment, and state transition.
- The server generates a unique `playerId` and random reconnect token. The browser stores the token locally; the server stores the token itself as-is rather than storing only a hash. The token restores the same identity and game data, is never shown to other players, and has no automatic recovery if lost. It becomes invalid for that match once the player is Forfeited. Never write reconnect tokens, secret credentials, or sensitive authentication data to any log.
- **Security risk:** because the reconnect token is stored as-is, database exposure could expose valid tokens. Reconsider this choice before production deployment; do not silently change the approved storage choice during implementation.
- Apply rate limiting and use unique transaction IDs for auction payments, first-purchase attempts, Kuhhandel offers, acceptances, counteroffers, and transfers. Prevent duplicate transactions.
- Maintain an immutable internal Audit Log distinct from the player-visible Public Game Log. Record room creation/deletion; match start/end; player join, leave, reconnect, and forfeiture; host transfers; auction, payment, and negotiation operations including successes and failures; rejected invalid requests with rejection reasons; and important server errors and exceptions. Never expose this log to ordinary players, and never record reconnect tokens, secret credentials, or sensitive authentication data in it.
- Keep a player's money hand private except when a rule explicitly reveals it: publicly submitted Kuhhandel cards, and the remaining hand of a player who fails auction payment or forfeits as a disconnected high bidder. Successful auction payment logs show the final amount, not the selected card denominations.
- No account or password is required. Delete temporary room data at its approved cleanup point; keep no permanent match history.

### 2.17 Exact-deadline decisions

Server receipt time is authoritative. For the actions listed below, a valid request received exactly at the stated deadline is accepted; one received after the deadline is rejected.

| Action                           | Exact-deadline result                                                          |
| -------------------------------- | ------------------------------------------------------------------------------ |
| Auction bid                      | Accept it and reset the auction timer to 15 seconds.                           |
| Payment confirmation             | Accept it if the selected cards are valid and cover the required amount.       |
| Kuhhandel Accept Offer           | Accept it if no conflicting action has already been processed.                 |
| Kuhhandel Counter Offer          | Accept it if no conflicting action has already been processed.                 |
| Reconnect                        | Accept it and restore the same identity and state.                             |
| Auctioneer first-purchase choice | Accept a valid choice; otherwise, an expired choice passes to the high bidder. |

For simultaneous valid bids or Kuhhandel actions, the first valid request received and processed by the server takes effect. Start Game versus room expiration is governed separately in section 2.7. Do not generalize exact-deadline acceptance to actions not listed here.

### 2.18 Simultaneous timer expirations

When multiple timers expire at exactly the same server instant, process their expirations in this order:

1. Reconnection-window expirations: mark affected players Forfeited first.
2. Action-timer expirations: payment, negotiation, Auctioneer first-purchase choice, and other action timers.
3. Room expiration and deletion.

This is the authoritative server-side order for timer expirations. It does not expand the exact-deadline acceptance table in section 2.17. A valid request received exactly at its deadline remains governed by that table.

## 3. Open Questions and Production Risk

These are the genuine unresolved details. Settled decisions above are not open questions.

- How to interleave a valid exact-deadline request with timer-expiration callbacks that have the same server timestamp, while preserving section 2.17's request rules and section 2.18's timer order.
- How to order multiple action-timer expirations within the same priority tier if their effects conflict.
- What happens if the original high bidder's payment timer expires while the Auctioneer's choice is paused by disconnection, or if the high bidder becomes Forfeited before that choice resolves (section 2.11).
- How a pending Auctioneer purchase is completed if the high bidder is disconnected and becomes Forfeited before payment is received (section 2.11).
- The raw reconnect-token storage choice is approved, but its production security risk requires reconsideration before deployment: database exposure could expose valid tokens.

Do not invent outcomes for these questions. The first positive opening bid, simultaneous timer priority, failed-payment disclosure visibility, Forfeited-player Lobby display, setup-failure expiration handling, and MVP Game Log/Match Replay scope are already decided above and are not open questions.

## Sources

- [`GAME_RULES.md`](./GAME_RULES.md) — official base-game rules and scoring reference.
- [Official Ravensburger rulebook PDF](https://product-files.ravensburger.cloud/manuals/662797.pdf) — controlling source for the original physical rules.
