/**
 * JOB-OPS Job Identity & Canonicalization Module
 * Unified deduplication, URL canonicalization, and job matching.
 */

import { createHash } from "crypto";

// Query params that are purely marketing/traffic tracking across all sources.
// Identity params like gh_jid, jobId, id, source, mode, sid, mid MUST NOT be stripped.
const PURE_TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_reader",
  "ref",
  "ref_id",
  "fbclid",
  "gclid",
  "trk",
  "trackingid",
  "tracking_id",
  "tracking",
  "lever-origin",
  "lever-source",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
  "mkt_tok",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ncid",
  "cmpid",
  "wt.mc_id",
]);

// Non-job URL path segments that indicate policy, corporate, or system pages
const BLOCKED_PATH_SEGMENTS = new Set([
  "privacy",
  "privacy-policy",
  "terms",
  "terms-of-service",
  "terms-and-conditions",
  "legal",
  "cookies",
  "cookie-policy",
  "about",
  "about-us",
  "contact",
  "contact-us",
  "help",
  "faq",
  "blog",
  "news",
  "press",
  "investor",
  "investors",
  "security",
  "vulnerability-disclosure",
  "sitemap",
  "feedback",
  "support",
  "team",
  "pricing",
  "customers",
  "features",
  "solutions",
  "login",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "auth",
  "oauth",
  "logout",
  "session",
  "forgot-password",
]);

// File extensions of assets that should never be considered job URLs
const ASSET_EXTENSION_REGEX = /\.(png|jpg|jpeg|gif|svg|pdf|css|js|woff|woff2|ico|zip|gz|tar|mp4|webm)$/i;

// Domains that should never be considered job postings
const NON_JOB_HOST_PATTERNS = [
  /^(www\.)?(facebook|twitter|x|instagram|youtube|tiktok|pinterest|reddit)\.com$/i,
  /^(www\.)?linkedin\.com\/(in|company|feed|groups)/i,
];

// Exact non-job titles (stoplist after normalization)
const EXACT_NON_JOB_TITLES = new Set([
  "privacy policy",
  "terms of service",
  "terms and conditions",
  "terms",
  "legal",
  "cookie policy",
  "cookie settings",
  "cookies",
  "about us",
  "about",
  "contact us",
  "contact",
  "security",
  "vulnerability disclosure",
  "vulnerability disclosure program",
  "create profile",
  "sign in",
  "sign up",
  "log in",
  "log out",
  "register",
  "careers",
  "jobs",
  "job openings",
  "all jobs",
  "open positions",
  "work with us",
  "join us",
  "join our team",
  "learn more",
  "read more",
  "see all",
  "view all",
  "apply now",
  "subscribe",
  "home",
  "search",
  "search jobs",
  "back to top",
  "load more",
  "our culture",
  "life at",
  "benefits",
  "why join us",
  "who we are",
  "what we do",
]);

// Prefix non-job title markers
const TITLE_STOP_PREFIXES = [
  "powered by",
  "copyright",
  "all rights reserved",
];

export const KNOWN_ATS_DOMAINS = [
  "greenhouse.io",
  "lever.co",
  "ashbyhq.com",
  "smartrecruiters.com",
  "workable.com",
  "myworkdayjobs.com",
  "icims.com",
  "bamboohr.com",
  "taleo.net",
];

export function isKnownAtsHost(hostname) {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return KNOWN_ATS_DOMAINS.some((domain) => lower === domain || lower.endsWith(`.${domain}`));
}

export function getRegistrableDomain(hostname) {
  if (!hostname || typeof hostname !== "string") return "";
  let host = hostname.toLowerCase().trim();
  if (host.startsWith("www.")) host = host.slice(4);
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const secondToLast = parts[parts.length - 2];
  const last = parts[parts.length - 1];
  if (["co", "com", "org", "net", "gov", "edu"].includes(secondToLast) && last.length === 2) {
    if (parts.length >= 3) {
      return parts.slice(-3).join(".");
    }
  }
  return parts.slice(-2).join(".");
}

export function isSameRegistrableDomain(hostA, hostB) {
  if (!hostA || !hostB) return false;
  const regA = getRegistrableDomain(hostA);
  const regB = getRegistrableDomain(hostB);
  return Boolean(regA && regB && regA === regB);
}

// Legal/corporate suffixes to strip when normalizing company names
const COMPANY_SUFFIX_REGEX = /\b(inc(\.|\b)|incorporated|llc|pvt(\.|\b)|private\s+limited|limited|ltd(\.|\b)|technologies|technology|solutions|services|corp(\.|\b)|corporation|group|software|labs)\b/gi;

/**
 * Canonicalizes a job URL by:
 * - Trimming and parsing URL
 * - Standardizing protocol (http/https)
 * - Lowercasing hostname and removing 'www.'
 * - Stripping tracking parameters
 * - Sorting remaining query parameters alphabetically
 * - Stripping fragment (#...)
 * - Stripping trailing slash from path (except root /)
 */
export function canonicalizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return "";
  const trimmed = rawUrl.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return "";

  try {
    const parsed = new URL(trimmed);
    const protocol = parsed.protocol.toLowerCase();
    let hostname = parsed.hostname.toLowerCase();
    if (hostname.startsWith("www.")) {
      hostname = hostname.slice(4);
    }

    // Strip trailing slash from pathname if length > 1
    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    // Filter and sort query params
    const cleanParams = new URLSearchParams();
    const sortedKeys = [...parsed.searchParams.keys()].sort();
    for (const key of sortedKeys) {
      const lowerKey = key.toLowerCase();
      if (lowerKey.startsWith("utm_") || PURE_TRACKING_PARAMS.has(lowerKey)) {
        continue;
      }
      for (const val of parsed.searchParams.getAll(key)) {
        cleanParams.append(key, val);
      }
    }

    const search = cleanParams.toString() ? `?${cleanParams.toString()}` : "";
    const port = parsed.port && parsed.port !== "80" && parsed.port !== "443" ? `:${parsed.port}` : "";

    return `${protocol}//${hostname}${port}${pathname}${search}`;
  } catch {
    return "";
  }
}

/**
 * Normalizes a company name for fuzzy matching.
 */
export function normalizeCompany(company) {
  if (!company || typeof company !== "string") return "";
  return company
    .replace(COMPANY_SUFFIX_REGEX, "")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Normalizes a role title for fuzzy matching.
 */
export function normalizeRole(role) {
  if (!role || typeof role !== "string") return "";
  return role
    .replace(/[^a-zA-Z0-9\s/+#.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Normalizes a location string.
 */
export function normalizeLocation(location) {
  if (!location || typeof location !== "string") return "";
  const normalized = location.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized === "unknown" || normalized === "null" || normalized === "undefined") {
    return "";
  }
  return normalized;
}

/**
 * Computes a soft composite key: `job:${company}|${role}|${location}`
 */
export function softKey(company, role, location = "") {
  const c = normalizeCompany(company);
  const r = normalizeRole(role);
  const l = normalizeLocation(location);
  if (!c && !r) return "";
  return l ? `job:${c}|${r}|${l}` : `job:${c}|${r}`;
}

/**
 * Computes deterministic unique key for a job or URL.
 * Prefers canonical URL (`url:<canon>`); falls back to softKey (`job:...`).
 */
export function jobKey(recordOrUrl) {
  if (!recordOrUrl) return "";

  if (typeof recordOrUrl === "string") {
    const canon = canonicalizeUrl(recordOrUrl);
    return canon ? `url:${canon}` : `raw:${recordOrUrl.trim().toLowerCase()}`;
  }

  const rawUrl = recordOrUrl.url || recordOrUrl.apply_url || recordOrUrl.hostedUrl || recordOrUrl.link || recordOrUrl.href;
  const canon = canonicalizeUrl(rawUrl);
  if (canon) {
    return `url:${canon}`;
  }

  const role = recordOrUrl.role || recordOrUrl.title;
  return softKey(recordOrUrl.company, role, recordOrUrl.location);
}

/**
 * Checks whether two job records represent the same job.
 */
export function isSameJob(jobA = {}, jobB = {}) {
  if (!jobA || !jobB) return false;

  const urlA = canonicalizeUrl(jobA.url || jobA.apply_url || jobA.hostedUrl || jobA.href);
  const urlB = canonicalizeUrl(jobB.url || jobB.apply_url || jobB.hostedUrl || jobB.href);

  if (urlA && urlB) {
    return urlA === urlB;
  }

  const roleA = normalizeRole(jobA.role || jobA.title);
  const roleB = normalizeRole(jobB.role || jobB.title);
  const companyA = normalizeCompany(jobA.company);
  const companyB = normalizeCompany(jobB.company);

  if (companyA && roleA && companyA === companyB && roleA === roleB) {
    const locA = normalizeLocation(jobA.location);
    const locB = normalizeLocation(jobB.location);

    // If both have distinct locations, compare them. If one is subset or empty/remote, treat as soft match.
    if (locA && locB && locA !== locB) {
      const isSubset = locA.includes(locB) || locB.includes(locA);
      const isRemoteA = locA.includes("remote");
      const isRemoteB = locB.includes("remote");
      if (!isSubset && !isRemoteA && !isRemoteB) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/**
 * Validates if a URL is likely a real job listing and not a navigation, policy, or asset link.
 * Supports source allowlists, same-host / ATS validation for careers pages, and segment blocking.
 */
export function isJobUrlValid(rawUrl, { source, baseHost } = {}) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;

  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    // 1. Social & non-job host check
    const full = `${hostname}${pathname}`;
    for (const pattern of NON_JOB_HOST_PATTERNS) {
      if (pattern.test(full)) return false;
    }

    // 2. Asset extension check
    if (ASSET_EXTENSION_REGEX.test(pathname)) return false;

    // 3. Root URL check: if pathname is empty or '/' (or top-level index) and no job query param exists
    const hasJobParam =
      parsed.searchParams.has("gh_jid") ||
      parsed.searchParams.has("jobId") ||
      parsed.searchParams.has("job_id") ||
      parsed.searchParams.has("id") ||
      parsed.searchParams.has("jid");

    const isRootLike = pathname === "" || pathname === "/" || pathname === "/jobs" || pathname === "/careers";
    if (isRootLike && !hasJobParam) {
      return false;
    }

    // 4. Positive source allowlists
    // Ashby: host jobs.ashbyhq.com or ashbyhq.com, path /<org>/<uuid>
    if (hostname === "jobs.ashbyhq.com" || hostname.endsWith(".ashbyhq.com") || hostname === "ashbyhq.com") {
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length < 2) return false;
    }

    // Greenhouse: boards.greenhouse.io or job-boards.greenhouse.io
    if (hostname.includes("greenhouse.io")) {
      const isJobPath = /\/jobs\/\d+/i.test(pathname);
      if (!isJobPath && !parsed.searchParams.has("gh_jid")) return false;
    }

    // Lever: jobs.lever.co/<slug>/<uuid>
    if (hostname === "jobs.lever.co") {
      const segments = pathname.split("/").filter(Boolean);
      if (segments.length < 2) return false;
    }

    // Wellfound: path /jobs/<digits>-... (reject /jobs/signup, /jobs/login, etc.)
    if (hostname.includes("wellfound.com")) {
      if (!/^\/jobs\/\d+/i.test(pathname)) return false;
    }

    // Internshala: path contains /job/detail/
    if (hostname.includes("internshala.com")) {
      if (!pathname.includes("/job/detail/")) return false;
    }

    // Naukri: path contains /job-listings- or -jobs-
    if (hostname.includes("naukri.com")) {
      if (!pathname.includes("/job-listings-") && !pathname.includes("-jobs-")) return false;
    }

    // Same-host / registrable domain check for generic careers pages
    if (baseHost) {
      const isAts = isKnownAtsHost(hostname);
      const isSameDomain = isSameRegistrableDomain(hostname, baseHost);
      if (!isAts && !isSameDomain) {
        return false;
      }
    }

    // 5. Blocklist safety net: whole path segment matching (NEVER \b substrings on slugs)
    const segments = pathname
      .split("/")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    for (const segment of segments) {
      if (BLOCKED_PATH_SEGMENTS.has(segment)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * Validates if a title is a plausible job role and not a navigation or site UI string.
 */
export function isJobTitleValid(title) {
  if (!title || typeof title !== "string") return false;
  const cleaned = title.replace(/\s+/g, " ").trim();
  if (cleaned.length < 3 || cleaned.length > 120) return false;

  const normalized = cleaned
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (EXACT_NON_JOB_TITLES.has(normalized)) return false;

  for (const prefix of TITLE_STOP_PREFIXES) {
    if (normalized.startsWith(prefix)) return false;
  }

  return true;
}
