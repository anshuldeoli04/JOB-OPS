import dns from "node:dns";
import net from "node:net";

/**
 * Checks whether an IPv4 address is in a private, loopback, or reserved range.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv4(ip) {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // Malformed IPv4 treated as unsafe
  }

  const [a, b] = parts;

  // 0.0.0.0/8: Current network
  if (a === 0) return true;

  // 10.0.0.0/8: Private
  if (a === 10) return true;

  // 100.64.0.0/10: Shared Address Space (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8: Loopback
  if (a === 127) return true;

  // 169.254.0.0/16: Link-local (AWS/GCP/Azure metadata service)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12: Private
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24: IETF Protocol Assignments
  if (a === 192 && b === 0 && parts[2] === 0) return true;

  // 192.0.2.0/24: Documentation (TEST-NET-1)
  if (a === 192 && b === 0 && parts[2] === 2) return true;

  // 192.88.99.0/24: 6to4 Relay Anycast
  if (a === 192 && b === 88 && parts[2] === 99) return true;

  // 192.168.0.0/16: Private
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15: Benchmarking
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24: Documentation (TEST-NET-2)
  if (a === 198 && b === 51 && parts[2] === 100) return true;

  // 203.0.113.0/24: Documentation (TEST-NET-3)
  if (a === 203 && b === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4: Multicast
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4: Reserved (including 255.255.255.255 broadcast)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks whether an IPv6 address is in a private, loopback, or reserved range.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIpv6(ip) {
  const normalized = ip.toLowerCase().trim();

  // IPv6 loopback
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;

  // Unspecified address
  if (normalized === "::" || normalized === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 address (::ffff:192.168.1.1)
  if (normalized.startsWith("::ffff:")) {
    const rawIpv4 = normalized.slice(7);
    if (net.isIPv4(rawIpv4)) {
      return isPrivateOrReservedIpv4(rawIpv4);
    }
  }

  // IPv6 unique local addresses: fc00::/7 (fc00:: to fdff::)
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  // IPv6 link-local addresses: fe80::/10 (fe80:: to febf::)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // Discard prefix: 100::/64
  if (normalized.startsWith("100:")) return true;

  // Documentation: 2001:db8::/32
  if (normalized.startsWith("2001:db8:") || normalized.startsWith("2001:0db8:")) return true;

  return false;
}

/**
 * Checks whether any IP address is private, loopback, or reserved.
 * @param {string} ip
 * @returns {boolean}
 */
export function isPrivateOrReservedIp(ip) {
  if (!ip || typeof ip !== "string") return true;
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateOrReservedIpv4(ip);
  if (kind === 6) return isPrivateOrReservedIpv6(ip);
  return true;
}

/**
 * Validates a target URL against SSRF attacks.
 * Verifies protocol (http/https), resolves domain names via DNS,
 * and ensures resolved IPs do not belong to private or reserved ranges.
 *
 * @param {string} targetUrl
 * @param {object} [options]
 * @param {function} [options.lookupFn] Custom DNS lookup function for testing
 * @returns {Promise<{ safe: boolean, reason?: string, ip?: string, hostname?: string }>}
 */
export async function validateSafeUrl(targetUrl, options = {}) {
  if (!targetUrl || typeof targetUrl !== "string") {
    return { safe: false, valid: false, reason: "URL must be a non-empty string" };
  }

  let parsed;
  try {
    parsed = new URL(targetUrl.trim());
  } catch {
    return { safe: false, valid: false, reason: "Invalid URL format" };
  }

  // Enforce protocol restriction: strictly http: or https:
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") {
    return {
      safe: false,
      valid: false,
      reason: `Unsupported protocol: "${protocol}". Only http: and https: are allowed.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();
  if (!hostname) {
    return { safe: false, valid: false, reason: "Hostname is missing" };
  }

  // Reject localhost and local domains
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    return {
      safe: false,
      valid: false,
      hostname,
      reason: `Local domain "${hostname}" is blocked`,
    };
  }

  // Check if hostname is an IP literal
  const ipType = net.isIP(hostname);
  if (ipType !== 0) {
    if (isPrivateOrReservedIp(hostname)) {
      return {
        safe: false,
        valid: false,
        hostname,
        ip: hostname,
        reason: `IP "${hostname}" is in a private or reserved range`,
      };
    }
    return { safe: true, valid: true, hostname, ip: hostname };
  }

  // Domain name: resolve DNS
  const lookup = options.lookupFn || dns.promises.lookup;
  try {
    const addresses = await lookup(hostname, { all: true });
    if (!addresses || addresses.length === 0) {
      return { safe: false, valid: false, hostname, reason: "DNS resolution returned no addresses" };
    }

    for (const record of addresses) {
      const address = typeof record === "string" ? record : record.address;
      if (isPrivateOrReservedIp(address)) {
        return {
          safe: false,
          valid: false,
          hostname,
          ip: address,
          reason: `Domain resolved to private or reserved IP "${address}"`,
        };
      }
    }

    return {
      safe: true,
      valid: true,
      hostname,
      ip: typeof addresses[0] === "string" ? addresses[0] : addresses[0].address,
    };
  } catch (err) {
    return {
      safe: false,
      valid: false,
      hostname,
      reason: `DNS lookup failed: ${err.message}`,
    };
  }
}

/**
 * Boolean wrapper for validateSafeUrl.
 * @param {string} targetUrl
 * @param {object} [options]
 * @returns {Promise<boolean>}
 */
export async function isSafeUrl(targetUrl, options = {}) {
  const result = await validateSafeUrl(targetUrl, options);
  return result.safe;
}
