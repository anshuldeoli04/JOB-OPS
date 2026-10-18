import fs from "fs";
import path from "path";
import { getDataFilePath } from "../config/configPaths.mjs";
import { logger } from "../../logger.mjs";
import { validateSafeUrl } from "../utils/urlValidator.mjs";

async function safeFetchJson(url, maxRedirects = 5) {
  let currentUrl = url;
  let redirects = 0;
  while (redirects <= maxRedirects) {
    const safe = await validateSafeUrl(currentUrl);
    if (!safe.safe && !safe.valid) {
      throw new Error(`SSRF blocked: ${safe.reason}`);
    }
    const res = await fetch(currentUrl, { redirect: "manual" });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error("Redirect with missing Location header");
      currentUrl = new URL(loc, currentUrl).href;
      redirects++;
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}

export async function verifySources(companies) {
  logger.info("\n" + "=".repeat(115));
  logger.info("           JOB-OPS ATS SOURCE & SLUG VERIFICATION");
  logger.info("=".repeat(115) + "\n");

  const results = [];
  const pad = (s, n) => String(s || "").padEnd(n);
  const padNum = (n, w) => String(n != null ? n : "-").padStart(w);

  logger.info(
    `${pad("COMPANY", 20)} | ${pad("CURRENT ATS", 14)} | ${pad("CURRENT SLUG", 22)} | ${pad("FOUND ATS", 12)} | ${pad("DISCOVERED SLUG", 20)} | ${padNum("JOBS", 6)} | STATUS`
  );
  logger.info("-".repeat(115));

  for (const c of companies) {
    if (c.disabled) {
      logger.info(
        `${pad(c.name, 20)} | ${pad(c.type || "-", 14)} | ${pad(c.slug || "-", 22).slice(0, 22)} | ${pad("-", 12)} | ${pad("-", 20)} | ${padNum("-", 6)} | DISABLED (${c.reason || "configured"})`
      );
      results.push({
        company: c.name,
        current_type: c.type,
        current_slug: c.slug || null,
        current_url: c.url || null,
        status: "DISABLED",
        reason: c.reason || "disabled in config",
      });
      continue;
    }

    if (c.type === "careers_page") {
      logger.info(
        `${pad(c.name, 20)} | ${pad("careers_page", 14)} | ${pad(c.url || "-", 22).slice(0, 22)} | ${pad("careers_page", 12)} | ${pad("-", 20)} | ${padNum("-", 6)} | CAREERS_PAGE`
      );
      results.push({
        company: c.name,
        current_type: "careers_page",
        current_url: c.url || null,
        status: "CAREERS_PAGE",
        recommendation: "Scraped via Playwright",
      });
      continue;
    }

    const slugs = [
      c.slug,
      ...(c.slugs || []),
      ...(c.aliases || []),
      c.name.toLowerCase().replace(/[^a-z0-9]/g, ""),
      c.name.toLowerCase().replace(/\s+/g, "-"),
      c.name.toLowerCase().replace(/\s+/g, ""),
    ].filter(Boolean);

    const triedSlugs = [...new Set(slugs)];
    let discovered = null;
    let lastError = null;

    for (const slug of triedSlugs) {
      // Check Greenhouse
      try {
        const gh = await safeFetchJson(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs`);
        if (gh.ok) {
          const d = await gh.json();
          discovered = { ats: "greenhouse", slug, count: d.jobs?.length || 0 };
          break;
        } else if (gh.status !== 404) {
          lastError = { status: gh.status, ats: "greenhouse" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }

      // Check Ashby
      try {
        const ash = await safeFetchJson(`https://api.ashbyhq.com/posting-api/job-board/${slug}`);
        if (ash.ok) {
          const d = await ash.json();
          discovered = { ats: "ashby", slug, count: d.jobs?.length || 0 };
          break;
        } else if (ash.status !== 404) {
          lastError = { status: ash.status, ats: "ashby" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }

      // Check Lever
      try {
        const lev = await safeFetchJson(`https://api.lever.co/v0/postings/${slug}?mode=json`);
        if (lev.ok) {
          const d = await lev.json();
          discovered = { ats: "lever", slug, count: Array.isArray(d) ? d.length : 0 };
          break;
        } else if (lev.status !== 404) {
          lastError = { status: lev.status, ats: "lever" };
        }
      } catch (e) {
        lastError = { error: e.message };
      }
    }

    let status = "SLUG_NOT_FOUND";
    let recommendation = "Verify manual careers URL or mark disabled";

    if (discovered) {
      status = "FOUND";
      if (discovered.ats === c.type && discovered.slug === c.slug) {
        recommendation = "Verified ok";
      } else {
        recommendation = `Update type to "${discovered.ats}" and slug to "${discovered.slug}"`;
      }
    } else if (lastError?.status === 429) {
      status = "RATE_LIMITED";
      recommendation = "Retry later";
    } else if (lastError?.status === 403 || lastError?.status === 401) {
      status = "BLOCKED";
      recommendation = "Blocked or requires authentication";
    } else if (lastError?.error) {
      status = "ERROR";
      recommendation = `Network error: ${lastError.error}`;
    }

    results.push({
      company: c.name,
      current_type: c.type,
      current_slug: c.slug || null,
      tried_slugs: triedSlugs,
      discovered_ats: discovered?.ats || null,
      discovered_slug: discovered?.slug || null,
      job_count: discovered?.count ?? null,
      status,
      recommendation,
    });

    logger.info(
      `${pad(c.name, 20)} | ${pad(c.type, 14)} | ${pad(c.slug || "-", 22).slice(0, 22)} | ${pad(discovered?.ats || "-", 12)} | ${pad(discovered?.slug || "-", 20)} | ${padNum(discovered?.count, 6)} | ${status}`
    );
  }

  logger.info("-".repeat(115) + "\n");
  const outPath = getDataFilePath("verify-sources.json");
  const outDir = path.dirname(outPath);
  if (!fs.existsSync(outDir)) {
    try {
      fs.mkdirSync(outDir, { recursive: true });
    } catch {}
  }
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2), "utf8");
  logger.info(`Results written to: ${outPath}\n`);
}
