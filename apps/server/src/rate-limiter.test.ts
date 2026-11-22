import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

describe("sliding-window rate limiter", () => {
  it("caps a caller and keeps independent caller buckets", () => {
    const limiter = new SlidingWindowRateLimiter(2, 60_000, () => 1_000);
    assert.equal(limiter.consume("player-a"), true);
    assert.equal(limiter.consume("player-a"), true);
    assert.equal(limiter.consume("player-a"), false);
    assert.equal(limiter.consume("player-b"), true);
  });

  it("opens a new window exactly at the configured boundary", () => {
    let now = 1_000;
    const limiter = new SlidingWindowRateLimiter(1, 60_000, () => now);
    assert.equal(limiter.consume("player-a"), true);
    assert.equal(limiter.consume("player-a"), false);
    now += 60_000;
    assert.equal(limiter.consume("player-a"), true);
  });
});
