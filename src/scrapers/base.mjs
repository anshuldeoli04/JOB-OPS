import { validateSafeUrl } from "../utils/urlValidator.mjs";
import { classifyApiSource, HEALTH } from "../../health.mjs";
import logger from "../../logger.mjs";

export const API_FETCH_RETRIES = 2;
export const MAX_REDIRECTS = 5;
export const STOCK_API_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36";

export class BaseScraper {
  constructor(name) {
    this.name = name;
  }

  async randomDelay(min = 1200, max = 3500) {
    const ms = Math.floor(Math.random() * (max - min) + min);
    await new Promise((r) => setTimeout(r, ms));
  }

  async fetchJson(url, options = {}) {
    // SEC-1: Validate initial safe URL to block SSRF attempts
    const initialCheck = await validateSafeUrl(url, options);
    if (!initialCheck.safe) {
      const ssrfError = new Error(`SSRF blocked: ${initialCheck.reason}`);
      ssrfError.status = 403;
      throw ssrfError;
    }

    let lastError = null;
    for (let attempt = 0; attempt <= API_FETCH_RETRIES; attempt++) {
      let currentUrl = url;
      let redirectCount = 0;

      while (redirectCount <= MAX_REDIRECTS) {
        let response;
        try {
          response = await fetch(currentUrl, {
            ...options,
            redirect: "manual",
            headers: {
              Accept: "application/json,text/plain,*/*",
              "User-Agent": STOCK_API_USER_AGENT,
              ...(options.headers || {}),
            },
          });
        } catch (fetchErr) {
          lastError = fetchErr;
          break;
        }

        // SEC-1: Prevent SSRF bypass via blind redirects
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const redirectLocation = response.headers.get("location");
          if (!redirectLocation) {
            const error = new Error(`Redirect with missing Location header from ${currentUrl}`);
            error.status = response.status;
            throw error;
          }

          let resolvedRedirectUrl;
          try {
            resolvedRedirectUrl = new URL(redirectLocation, currentUrl).href;
          } catch {
            const error = new Error(`Invalid redirect URL: ${redirectLocation}`);
            error.status = 400;
            throw error;
          }

          const redirectCheck = await validateSafeUrl(resolvedRedirectUrl, options);
          if (!redirectCheck.safe) {
            const ssrfError = new Error(`SSRF blocked on redirect: ${redirectCheck.reason}`);
            ssrfError.status = 403;
            throw ssrfError;
          }

          currentUrl = resolvedRedirectUrl;
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            const error = new Error(`Too many redirects (exceeded limit of ${MAX_REDIRECTS})`);
            error.status = 400;
            throw error;
          }
          continue;
        }

        const body = await response.text();
        if (!response.ok) {
          const error = new Error(`${response.status} ${response.statusText}`);
          error.status = response.status;
          error.bodyPreview = body.slice(0, 180).replace(/\s+/g, " ");
          lastError = error;
          if (![429, 500, 502, 503, 504].includes(response.status) || attempt === API_FETCH_RETRIES) {
            throw error;
          }
          await this.randomDelay(1500 * (attempt + 1), 3500 * (attempt + 1));
          break;
        }

        try {
          return JSON.parse(body);
        } catch (error) {
          error.bodyPreview = body.slice(0, 180).replace(/\s+/g, " ");
          throw error;
        }
      }
    }

    throw lastError || new Error(`Failed to fetch ${url}`);
  }

  recordFailure(stats, error) {
    if (error?.status === 404) stats.noBoard += 1;
    else if (error?.status === 401 || error?.status === 403) stats.blocked += 1;
    else if (error?.status === 429) stats.rateLimited += 1;
    else stats.errors += 1;
  }

  summarize(stats) {
    const status = classifyApiSource(stats);
    const skipped = stats.noBoard + stats.blocked + stats.rateLimited + stats.errors;
    if (!stats.total) return HEALTH.SKIPPED;
    logger.info(
      `   ${this.name} summary: ${stats.success}/${stats.total} boards ok [${status}], ${stats.matched} matched, ${skipped} skipped`
    );
    if (stats.success === 0 && skipped === stats.total) {
      logger.warn(
        `   ${this.name} systematic failure: check ATS slugs/network/rate limits. Run with updated slugs in companies.json.`
      );
    }
    return status;
  }

  async scan() {
    throw new Error(`Method scan() must be implemented by ${this.constructor.name}`);
  }
}
