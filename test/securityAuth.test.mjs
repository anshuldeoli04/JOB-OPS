import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const hasFrontend = fs.existsSync(path.resolve("frontend/server/index.js"));

let app, generateToken, issueTicket, consumeTicket, query;
if (hasFrontend) {
  const index = await import("../frontend/server/index.js");
  const tokenAuth = await import("../frontend/server/utils/tokenAuth.js");
  const db = await import("../frontend/server/utils/db.js");
  app = index.app;
  generateToken = tokenAuth.generateToken;
  issueTicket = tokenAuth.issueTicket;
  consumeTicket = tokenAuth.consumeTicket;
  query = db.query;
}

if (!hasFrontend) {
  test("Frontend security and auth tests", (t) => {
    t.skip("frontend/ directory is excluded from standalone CLI distribution");
  });
} else {
  // Helper to start an ephemeral test server instance
  function createTestServer() {
    return new Promise((resolve) => {
      const server = app.listen(0, "127.0.0.1", () => {
        const { port } = server.address();
        resolve({
          server,
          baseUrl: `http://127.0.0.1:${port}`,
          close: () => new Promise((res) => server.close(res))
        });
      });
    });
  }

  test("T4: Security headers and disabling of x-powered-by", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const res = await fetch(`${baseUrl}/health`);
    assert.strictEqual(res.headers.get("x-powered-by"), null, "X-Powered-By header must be disabled");
    assert.ok(
      res.headers.get("x-content-type-options") === "nosniff" ||
      res.headers.has("content-security-policy") ||
      res.headers.has("strict-transport-security"),
      "Helmet security headers must be present"
    );
  } finally {
    await close();
  }
});

test("T4: Password policy rejects short or whitespace-containing passwords", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // Password shorter than 10 characters
    const shortRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Short Pass", email: "short@example.com", password: "short" })
    });
    assert.strictEqual(shortRes.status, 400);
    const shortBody = await shortRes.json();
    assert.ok(shortBody.error.includes("at least 10 characters"));

    // Password with whitespace
    const spaceRes = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Space Pass", email: "space@example.com", password: "pass word 12345" })
    });
    assert.strictEqual(spaceRes.status, 400);
    const spaceBody = await spaceRes.json();
    assert.ok(spaceBody.error.includes("whitespace"));
  } finally {
    await close();
  }
});

test("T6: Report & Output file authorization prevents cross-user access and wildcard matching", async () => {
  const { baseUrl, close } = await createTestServer();
  const reportsDir = path.resolve("reports");
  fs.mkdirSync(reportsDir, { recursive: true });

  const testReportFile = path.join(reportsDir, "u1_unit_test_auth_check.md");
  fs.writeFileSync(testReportFile, "# Test Report for User 1", "utf8");

  try {
    const user1Token = generateToken(1, 1);
    const user2Token = generateToken(2, 1);

    // User 1 requests their own report -> 200
    const resA = await fetch(`${baseUrl}/files/reports/u1_unit_test_auth_check.md`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    assert.strictEqual(resA.status, 200, "User 1 should be authorized to read u1 report");

    // User 2 requests User 1's report -> 403 Forbidden
    const resB = await fetch(`${baseUrl}/files/reports/u1_unit_test_auth_check.md`, {
      headers: { Authorization: `Bearer ${user2Token}` }
    });
    assert.strictEqual(resB.status, 403, "User 2 must be rejected with 403 when requesting u1 report");

    // Request with URL-encoded wildcard % (%25) to output/ -> must be 403 or 404, NEVER 200
    const resWildcard = await fetch(`${baseUrl}/files/output/%25`, {
      headers: { Authorization: `Bearer ${user1Token}` }
    });
    assert.notStrictEqual(resWildcard.status, 200, "Wildcard % query must not return 200");
    assert.ok([403, 404].includes(resWildcard.status), "Wildcard query should return 403 or 404");
  } finally {
    if (fs.existsSync(testReportFile)) {
      fs.unlinkSync(testReportFile);
    }
    await close();
  }
});

test("T7: Auth token query string rejection, ticket issuance, and single-use consumption", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const validToken = generateToken(999, 1);

    // 1. Query-string ?token= is NOT accepted for API endpoints
    const resQueryToken = await fetch(`${baseUrl}/api/applications?token=${validToken}`);
    assert.strictEqual(resQueryToken.status, 401, "GET /api/applications?token=... must return 401 Unauthorized");

    // 2. Issue a short-lived single-use ticket
    const ticket = issueTicket(999);
    assert.ok(ticket, "issueTicket should return a ticket string");

    // 3. First consumption of ticket via ?ticket= succeeds
    const ticketUserId = consumeTicket(ticket);
    assert.strictEqual(ticketUserId, 999, "consumeTicket should return the user ID on first call");

    // 4. Second consumption of the same ticket fails (single-use)
    const reusedTicket = consumeTicket(ticket);
    assert.strictEqual(reusedTicket, null, "consumeTicket must return null when ticket is reused");
  } finally {
    await close();
  }
});

test("T7: Logout and version increment revokes prior session tokens", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const testEmail = `tokenrevocation-${Date.now()}@example.com`;
    const insertRes = await query(
      `INSERT INTO users (name, email, password_hash, token_version)
       VALUES ('Token Test', :testEmail, '$2b$10$abcdefghijklmnopqrstuvwxyz123456', 1)
       RETURNING id`,
      { testEmail }
    ).catch(() => null);

    if (insertRes && insertRes[0]?.id) {
      const testUserId = insertRes[0].id;
      const initialToken = generateToken(testUserId, 1);

      // Access before revocation -> 200
      const resBefore = await fetch(`${baseUrl}/api/applications`, {
        headers: { Authorization: `Bearer ${initialToken}` }
      });
      assert.strictEqual(resBefore.status, 200, "Token with matching version should succeed");

      // Logout request to revoke tokens
      const resLogout = await fetch(`${baseUrl}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${initialToken}` }
      });
      assert.strictEqual(resLogout.status, 200, "Logout should succeed");

      // Access with same initial token after logout -> 401 Unauthorized
      const resAfter = await fetch(`${baseUrl}/api/applications`, {
        headers: { Authorization: `Bearer ${initialToken}` }
      });
      assert.strictEqual(resAfter.status, 401, "Revoked token must be rejected with 401");

      // Cleanup
      await query(`DELETE FROM users WHERE id = :testUserId`, { testUserId }).catch(() => {});
    }
  } finally {
    await close();
  }
});

test("T4: Rate limiter enforces limit on /api/auth/login", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    const results = [];
    // Send 12 rapid failed login attempts
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: `ratelimit-test-${i}@example.com`, password: "wrongpassword123" })
      });
      results.push(res.status);
    }

    // First attempts should be 401 (invalid credentials)
    assert.strictEqual(results[0], 401, "First login attempt should return 401");
    // After 10 attempts in the 15-min window, subsequent attempts must be 429 (Too Many Requests)
    const has429 = results.slice(10).some((status) => status === 429);
    assert.ok(has429, `Expected HTTP 429 rate limit response in subsequent requests, got: ${results.slice(10).join(",")}`);
  } finally {
    await close();
  }
});

test("T7: Code hygiene verification (no password sha256, no request-less session fallback, no mysql2)", () => {
  // 1. Verify no password-related createHash('sha256') remains in frontend/server
  const authCode = fs.readFileSync("frontend/server/routes/auth.js", "utf8");
  assert.ok(!authCode.includes("createHash('sha256')"), "Legacy sha256 password hash must be removed from routes/auth.js");

  // 2. Verify mysql2 is removed from frontend/package.json
  const pkg = JSON.parse(fs.readFileSync("frontend/package.json", "utf8"));
  assert.strictEqual(pkg.dependencies?.mysql2, undefined, "mysql2 must not be present in dependencies");

  // 3. Verify currentUser.js does not fall back to getSessionUserId()
  const currentUserCode = fs.readFileSync("frontend/server/utils/currentUser.js", "utf8");
  assert.ok(!currentUserCode.includes("getSessionUserId()"), "currentUser.js must not contain request-less getSessionUserId fallback");
});

test("CodeRabbit: /api/config/cv-pdf allows unauthenticated onboarding upload while test-key requires auth", async () => {
  const { baseUrl, close } = await createTestServer();
  try {
    // 1. Unauthenticated /cv-pdf should NOT reject with 401
    const resCv = await fetch(`${baseUrl}/api/config/cv-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: Buffer.alloc(0)
    });
    assert.notStrictEqual(resCv.status, 401, "Unauthenticated /cv-pdf must not return 401");
    assert.strictEqual(resCv.status, 400, "Empty PDF body should return 400 bad request");

    // 2. Unauthenticated /test-key MUST reject with 401
    const resTestKey = await fetch(`${baseUrl}/api/config/test-key`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: "dummy" })
    });
    assert.strictEqual(resTestKey.status, 401, "Unauthenticated /test-key must return 401");
  } finally {
    await close();
  }
});
}
