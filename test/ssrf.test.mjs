import test from "node:test";
import assert from "node:assert/strict";
import { validateSafeUrl, isSafeUrl } from "../jobIdentity.mjs";

test("SSRF SEC-1: Rejects unsupported protocols (file, javascript, ftp, data)", async () => {
  const badUrls = [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "ftp://ftp.example.com/file",
    "data:text/html,<script>alert(1)</script>",
    "gopher://127.0.0.1:70",
  ];

  for (const url of badUrls) {
    const res = await validateSafeUrl(url);
    assert.strictEqual(res.safe, false, `Expected ${url} to be unsafe`);
    assert.ok(res.reason.includes("Unsupported protocol") || res.reason.includes("Invalid URL"));
    assert.strictEqual(await isSafeUrl(url), false);
  }
});

test("SSRF SEC-1: Rejects localhost and local domain names", async () => {
  const localDomains = [
    "http://localhost/jobs",
    "https://localhost:8080/api",
    "http://myhost.localhost/feed",
    "http://internal.local/careers",
    "http://service.internal/jobs",
  ];

  for (const url of localDomains) {
    const res = await validateSafeUrl(url);
    assert.strictEqual(res.safe, false, `Expected ${url} to be rejected`);
    assert.ok(res.reason.includes("blocked"));
    assert.strictEqual(await isSafeUrl(url), false);
  }
});

test("SSRF SEC-1: Rejects private and loopback IPv4 literals", async () => {
  const privateIps = [
    "http://127.0.0.1/jobs",
    "http://127.0.1.5:3000",
    "http://10.0.0.1/admin",
    "http://10.255.255.254/status",
    "http://172.16.0.1/metadata",
    "http://172.31.255.255/internal",
    "http://192.168.1.1/router",
    "http://192.168.100.50/jobs",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.1.1/aws",
    "http://0.0.0.0:8000",
    "http://100.64.0.1/cgnat",
  ];

  for (const url of privateIps) {
    const res = await validateSafeUrl(url);
    assert.strictEqual(res.safe, false, `Expected ${url} to be rejected`);
    assert.ok(res.reason.includes("private or reserved"));
    assert.strictEqual(await isSafeUrl(url), false);
  }
});

test("SSRF SEC-1: Rejects private and loopback IPv6 literals", async () => {
  const privateIpv6 = [
    "http://[::1]/internal",
    "http://[fe80::1]/link-local",
    "http://[fc00::1]/unique-local",
    "http://[fd12:3456:789a::1]/internal",
    "http://[::ffff:127.0.0.1]/ipv4-mapped",
    "http://[::ffff:169.254.169.254]/cloud-meta",
  ];

  for (const url of privateIpv6) {
    const res = await validateSafeUrl(url);
    assert.strictEqual(res.safe, false, `Expected ${url} to be rejected`);
    assert.strictEqual(await isSafeUrl(url), false);
  }
});

test("SSRF SEC-1: Blocks domains that resolve to private or loopback IPs via DNS", async () => {
  const mockLookupPrivate = async () => [{ address: "127.0.0.1", family: 4 }];
  const resPrivate = await validateSafeUrl("http://evil-spoof.com/jobs", {
    lookupFn: mockLookupPrivate,
  });
  assert.strictEqual(resPrivate.safe, false);
  assert.ok(resPrivate.reason.includes("Domain resolved to private or reserved IP"));

  const mockLookupMetadata = async () => [{ address: "169.254.169.254", family: 4 }];
  const resMeta = await validateSafeUrl("http://cloud-imds.company.com", {
    lookupFn: mockLookupMetadata,
  });
  assert.strictEqual(resMeta.safe, false);
  assert.ok(resMeta.reason.includes("Domain resolved to private or reserved IP"));
});

test("SSRF SEC-1: Allows public domains with public IP resolution", async () => {
  const mockLookupPublic = async () => [{ address: "93.184.216.34", family: 4 }];
  const res = await validateSafeUrl("https://example.com/careers/engineer", {
    lookupFn: mockLookupPublic,
  });
  assert.strictEqual(res.safe, true);
  assert.strictEqual(res.ip, "93.184.216.34");
  assert.strictEqual(await isSafeUrl("https://example.com/careers", { lookupFn: mockLookupPublic }), true);
});

test("SSRF SEC-1: BaseScraper.fetchJson blocks HTTP redirects pointing to internal IPs", async () => {
  const { BaseScraper } = await import("../src/scrapers/base.mjs");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url === "https://example.com/api") {
        return {
          status: 302,
          headers: {
            get: (key) => (key.toLowerCase() === "location" ? "http://169.254.169.254/latest/meta-data" : null),
          },
        };
      }
      return { status: 200, ok: true, text: async () => "{}" };
    };

    const scraper = new BaseScraper("MockATS");
    await assert.rejects(
      () =>
        scraper.fetchJson("https://example.com/api", {
          lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        }),
      (err) => {
        assert.ok(err.message.includes("SSRF blocked on redirect"));
        assert.strictEqual(err.status, 403);
        return true;
      }
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("SSRF SEC-1: BaseScraper.fetchJson follows safe HTTP redirects cleanly", async () => {
  const { BaseScraper } = await import("../src/scrapers/base.mjs");
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (url === "https://example.com/api") {
        return {
          status: 301,
          headers: {
            get: (key) => (key.toLowerCase() === "location" ? "https://example.com/v2/api" : null),
          },
        };
      }
      if (url === "https://example.com/v2/api") {
        return {
          status: 200,
          ok: true,
          text: async () => JSON.stringify({ jobs: [{ id: 101, title: "Backend Engineer" }] }),
        };
      }
      return { status: 404, ok: false, statusText: "Not Found", text: async () => "" };
    };

    const scraper = new BaseScraper("MockATS");
    const result = await scraper.fetchJson("https://example.com/api", {
      lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    assert.deepStrictEqual(result, { jobs: [{ id: 101, title: "Backend Engineer" }] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
