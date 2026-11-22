# Animal Bluff — Base Game Rules

**Status:** rules reference for future implementation; no game logic is implemented here.

## 1. Scope and authority

This document describes the classic Ravensburger base game _Kuhhandel_ / _You're Bluffing!_ for 3–5 players, using the 40-animal-card and 55-money-card set. It excludes _Super-Kuhhandel_, short-game rules, first-edition bonus rules, and later spin-offs or board-game variants.

The [official Ravensburger rulebook PDF supplied for this project](https://product-files.ravensburger.cloud/manuals/662797.pdf) is the controlling source for these rules. The official [Ravensburger product page](https://www.ravensburger.de/de-DE/produkte/spiele/kartenspiele/kuhhandel-20753) also confirms that the player with the heaviest pet starts.

In the sections below:

- **Official rule** means a rule stated in the controlling Ravensburger PDF.
- **Digital implementation decision** means a detail the board-game rules do not prescribe and the online game must decide. It is not an official game rule.
- This document defines no digital implementation choices. Approved online adaptations and genuine open questions are maintained separately in [`DIGITAL_RULES.md`](./DIGITAL_RULES.md).

## 2. Goal and terms

Players acquire animals through auctions and hidden-money trades called **Kuhhandel**. Animals are public; money in a player's hand is private. At the end, only completed animal quartets score. Money has no end-game value.

A **quartet** is all four cards of one animal type. A **challenger** is the player initiating a Kuhhandel; the **challenged player** owns the matching animal and must respond. An **auctioneer** is the player whose turn starts an animal auction.

## 3. Components and card inventory

The standard set contains 40 animal cards (10 quartets of four cards each) and 55 money cards. The four cards in a quartet each show the same point value: that value is for the complete quartet, not for an individual card.

| Animal type                            |  Cards | Quartet value |
| -------------------------------------- | -----: | ------------: |
| Horse                                  |      4 |         1,000 |
| Cow                                    |      4 |           800 |
| Pig                                    |      4 |           650 |
| Donkey (the money-distribution animal) |      4 |           500 |
| Goat                                   |      4 |           350 |
| Sheep                                  |      4 |           250 |
| Dog                                    |      4 |           160 |
| Cat                                    |      4 |            90 |
| Goose                                  |      4 |            40 |
| Rooster                                |      4 |            10 |
| **Total**                              | **40** |             — |

| Money-card denomination |  Count |
| ----------------------: | -----: |
|                       0 |     10 |
|                      10 |     20 |
|                      50 |     10 |
|                     100 |      5 |
|                     200 |      5 |
|                     500 |      5 |
|               **Total** | **55** |

The 0 cards have no monetary value. They are useful for bluffing in Kuhhandel. A card's denomination is the amount it contributes when money is counted.

## 4. Setup and turn order

1. Use 3–5 players.
2. Shuffle all 40 animal cards and place them face down as a draw pile in the middle.
3. Sort the money cards by denomination. Each player takes, secretly into their hand, **two 0 cards, four 10 cards, and one 50 card**. This is seven cards with a face-value total of 90.
4. Place all remaining money cards in the bank/supply for later use, including the Donkey distributions. Do not remove money cards from the game during setup except for the starting hands.
5. All animal cards a player owns are placed face up so everyone can see them. Keep money hidden in hand except when a rule requires it to be offered, counted, or revealed.
6. The player with the **heaviest pet** starts. Thereafter, turns proceed clockwise. How to simulate this for online players is a digital implementation decision (see section 10).

At the start of a turn, the player chooses exactly one available action:

1. Auction the top animal card, if the animal draw pile is not empty; or
2. initiate a Kuhhandel with one eligible player, if one exists.

After the action is completed, play passes clockwise. Early in the game, only auctions are possible because nobody yet owns matching animals. Once the animal draw pile is empty, Kuhhandel is compulsory; players with only completed quartets are skipped. A completed quartet cannot be challenged.

## 5. Auctions

### 5.1 Starting and conducting an auction

1. The auctioneer turns over the top animal card and offers that animal for auction.
2. The auctioneer may not bid on the animal during their own auction.
3. The other players may make bids. Each new bid must be at least 10 money units higher than the previous high bid. A bidder may bid again when another player has raised the price.
4. When no one raises the high bid, the auctioneer calls the winning amount three times (for example, “30 going once, 30 going twice, gone for 30”) and closes the auction.
5. If a player other than the auctioneer wins, the auctioneer gives that player the animal and receives the winning bid from them.

The auctioneer has a **right of first purchase** after the winning bid is established: immediately after the call, the auctioneer may take the animal for themself by paying the winning bidder the bid amount. If the auctioneer does not exercise that right, the high bidder buys the animal from the auctioneer.

Players may not make change. If a player cannot pay the exact bid, they must pay a higher total amount using money cards; no change is returned. This also applies when the auctioneer exercises the right of first purchase.

### 5.2 Auction exceptions

- **No bids:** The auctioneer calls the animal three times. If nobody bids, the auctioneer takes the animal for free.
- **A bid the bidder cannot cover:** The bidder reveals all their money cards and the auction is repeated. In the repeated auction, that player must not bid more than the total value of the money they own. The official rule does not say to exclude the player, and it specifies no penalty or transfer of money for the failed bid.
- **No exact payment:** The buyer pays a higher total amount because change is never given.
- **Donkey revealed:** Pause the auction for the Donkey distribution in section 6, then resume and auction the Donkey normally.

Each new auction bid must exceed the previous high bid by at least 10. The official rules do not specify a minimum opening bid. Countdown timing and handling simultaneous or identical top bids are digital implementation decisions (see section 10).

## 6. Donkey money distribution

There are four Donkey animal cards. When a Donkey is revealed for auction, interrupt the auction and give **every player, including the auctioneer**, one money card of the scheduled denomination from the bank. Count Donkeys as they are revealed, not as they are won.

| Donkey revealed | Each player's distribution |
| --------------: | -------------------------: |
|             1st |                         50 |
|             2nd |                        100 |
|             3rd |                        200 |
|             4th |                        500 |

After everyone receives the card, auction the Donkey as usual. These payments are additions to players' money hands and can be used in later auctions or trades. The Donkey is still an animal quartet with a value of 500 points; its distribution effect is separate from its scoring value.

## 7. Kuhhandel (hidden-offer animal trade)

### 7.1 Who may trade and what is at stake

On their turn, a player may choose a Kuhhandel instead of auctioning an animal. They identify one player who owns the same animal type as they do and state that type. If several players qualify, the challenger chooses one of them. The challenged player may not refuse the trade; they must accept the offer or counteroffer.

Players cannot trade different animal types. A completed quartet is immune from challenge and cannot be traded away. The number of cards at stake is determined by the pair/triple rules in section 8, not chosen freely by the challenger.

### 7.2 Initial hidden offer and acceptance

The challenger places a face-down offer of any number of money cards for the animal(s) at stake. The offer may include 0 cards, consist only of 0 cards, or be an empty hand (no cards). Its value is the sum of the denominations offered.

The challenged player chooses one response:

- **Accept:** Take the challenger's offered money cards into their own hand and give the required animal card(s) to the challenger. The trade ends.
- **Counteroffer:** Secretly place any number of money cards face down as a counteroffer. The two face-down offers are exchanged and secretly counted. Only the two traders learn the compared values; other players do not. Each player keeps the money cards received from the other player. The player whose offer has the higher total value gets the opponent's animal card(s) at stake.

The number of cards in an offer is not its value; compare the sum of their denominations. Zero cards contribute zero. An empty offer also has value zero.

### 7.3 Equal counteroffers

If both offers have equal total value, the original challenger receives the challenged player's animal card(s) at stake. Both players keep the money cards they received from the other player. The official rulebook specifies no second tie round.

## 8. Pairs, triples, and completed quartets

For a Kuhhandel of a particular animal type:

- If both players have at least two uncompleted cards of that type, the trade is for **two cards from each player**. Each player either gains the opponent's pair or gives up their own pair, as determined by the money comparison.
- If only one player has two or three cards and the other has exactly one, the trade is for **one card from each player**. The player with two or three cards gives up only one card if they lose.
- A triple is not automatically traded as a whole. It follows the same count rule: two cards when both players have at least two; one card when the opponent has only one.
- A player with a completed quartet cannot be challenged for that type. A complete quartet cannot be included in a trade.
- After a transfer, update each player's visible animal cards. If a player now owns all four of a type, that quartet is complete and is no longer available for Kuhhandel.

These rules allow a trade to complete a quartet for its winner. They do not allow a player to challenge a complete quartet in order to break it.

## 9. End of game and scoring

Once the animal draw pile is exhausted, Kuhhandel becomes compulsory. Players with only completed quartets are skipped. The game ends when all quartets are complete.

For each player:

```text
quartetCount = number of completed animal quartets owned
quartetValueSum = sum of the printed quartet values for those quartets
score = quartetValueSum × quartetCount
```

Example: completed quartets worth 650, 160, and 10 total 820. With three quartets, the score is `820 × 3 = 2,460`.

Only completed quartets count. Money cards have no end-game value. The player with the highest score wins. The official rules do not specify a tie-break if two or more players have equal scores; see section 10.

## 10. Digital implementation decisions

The physical rules do not prescribe online timing, network ordering, or interface behavior. Those approved adaptations and any remaining digital questions are documented separately in [`DIGITAL_RULES.md`](./DIGITAL_RULES.md); they must not be presented as official Ravensburger rules.

## 11. Deliberately excluded rules

Do not apply the following to the default Animal Bluff ruleset:

- **Super-Kuhhandel:** taking an additional auction after a Kuhhandel.
- **Short game:** auctioning multiple animals at once.
- **First-edition rules:** different starting-money mix, the blue 500-point bonus card, additive-only scoring, or first-edition counteroffer handling.
- Rules or components from _Kuhhandel Master_, _Kuhhandel Festival_, the 2016 board game, or other adaptations.

## Sources

- [Official Ravensburger rulebook PDF](https://product-files.ravensburger.cloud/manuals/662797.pdf) — controlling rules source for Animal Bluff.
- [Official Ravensburger Kuhhandel product page](https://www.ravensburger.de/de-DE/produkte/spiele/kartenspiele/kuhhandel-20753) — confirms the heaviest-pet starting player and identifies the classic 3–5 player card game.
