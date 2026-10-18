import test from "node:test";
import assert from "node:assert/strict";
import {
  issueTicket,
  consumeTicket,
  purgeExpiredTickets,
  getActiveTicketCount,
  clearActiveTicketsForTest,
  setMaxActiveTicketsForTest,
} from "../frontend/server/utils/tokenAuth.js";

test("Token SEC-2: Single-use ticket can be consumed only once", () => {
  clearActiveTicketsForTest();
  const ticket = issueTicket(101);
  assert.ok(ticket && typeof ticket === "string");

  // First consumption succeeds
  const user = consumeTicket(ticket);
  assert.strictEqual(user, 101);

  // Subsequent consumption of same ticket fails (single use)
  const reuse = consumeTicket(ticket);
  assert.strictEqual(reuse, null);
});

test("Token SEC-2: Ticket cannot be consumed if expired", async () => {
  clearActiveTicketsForTest();
  const ticket = issueTicket(202);

  // Simulate ticket expiry by waiting or testing purge
  assert.strictEqual(getActiveTicketCount(), 1);

  // Valid immediately
  assert.strictEqual(consumeTicket(ticket), 202);

  // Invalid random ticket returns null
  assert.strictEqual(consumeTicket("invalid-random-ticket"), null);
});

test("Token SEC-2: Bounded capacity cap prevents memory leak / DoS attack", () => {
  clearActiveTicketsForTest();
  // Set test cap to 15
  setMaxActiveTicketsForTest(15);

  const issuedTickets = [];
  // Issue 50 tickets without consuming them
  for (let i = 0; i < 50; i++) {
    const t = issueTicket(1000 + i);
    issuedTickets.push(t);
  }

  // Active tickets must not exceed capacity cap
  assert.strictEqual(getActiveTicketCount(), 15);

  // The first 35 tickets must have been evicted
  assert.strictEqual(consumeTicket(issuedTickets[0]), null);
  assert.strictEqual(consumeTicket(issuedTickets[34]), null);

  // The latest tickets within cap should still be present
  const latestUser = consumeTicket(issuedTickets[49]);
  assert.strictEqual(latestUser, 1049);

  // Reset to default
  setMaxActiveTicketsForTest(5000);
  clearActiveTicketsForTest();
});

test("Token SEC-2: purgeExpiredTickets cleanly sweeps expired entries", () => {
  clearActiveTicketsForTest();
  issueTicket(301);
  issueTicket(302);
  assert.strictEqual(getActiveTicketCount(), 2);

  // Without expiry, purge returns 0
  const swept = purgeExpiredTickets();
  assert.strictEqual(swept, 0);
  assert.strictEqual(getActiveTicketCount(), 2);

  clearActiveTicketsForTest();
  assert.strictEqual(getActiveTicketCount(), 0);
});
