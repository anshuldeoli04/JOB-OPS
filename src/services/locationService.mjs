export const NON_INDIA_REGIONS = new Set([
  // Americas
  "us", "usa", "united states", "united states of america",
  "canada", "mexico", "brazil", "argentina", "colombia", "chile", "peru", "uruguay", "costa rica", "panama",
  "americas", "latam", "north america", "south america",
  // Europe
  "uk", "united kingdom", "great britain", "england", "scotland", "wales",
  "ireland", "germany", "france", "netherlands", "spain", "poland", "italy", "portugal",
  "sweden", "norway", "denmark", "finland", "switzerland", "austria", "belgium",
  "czechia", "czech republic", "romania", "bulgaria", "hungary", "greece", "ukraine",
  "estonia", "latvia", "lithuania", "croatia", "serbia", "slovakia", "slovenia",
  "iceland", "cyprus", "malta", "luxembourg", "europe", "emea", "eu",
  // Middle East & Africa
  "israel", "uae", "united arab emirates", "dubai", "abu dhabi", "saudi arabia", "qatar", "bahrain", "kuwait", "oman", "turkey", "egypt",
  "south africa", "nigeria", "kenya", "ghana", "morocco", "africa",
  // Asia-Pacific (non-India)
  "australia", "new zealand", "singapore", "japan", "south korea", "korea", "china", "hong kong", "taiwan",
  "malaysia", "indonesia", "philippines", "thailand", "vietnam"
]);

export const DEFAULT_INDIA_ALIASES = [
  "india", "pan india", "work from home", "wfh",
  "bengaluru", "bangalore",
  "gurugram", "gurgaon",
  "delhi", "new delhi", "ncr", "delhi ncr",
  "noida", "greater noida",
  "mumbai", "navi mumbai", "bombay",
  "pune", "maharashtra",
  "hyderabad", "secunderabad", "telangana",
  "chennai", "tamil nadu", "madras",
  "kolkata", "west bengal", "calcutta",
  "ahmedabad", "gujarat",
  "jaipur", "rajasthan",
  "chandigarh", "mohali", "punjab", "haryana",
  "indore", "madhya pradesh",
  "kochi", "cochin", "kerala",
  "karnataka"
];

export function isLocationFit(locStr, config = {}, source = "") {
  if (!locStr) {
    const src = String(source || "").toLowerCase();
    return src.includes("naukri") || src.includes("internshala");
  }

  const loc = String(locStr).toLowerCase().replace(/[\/,()_-]/g, " ").replace(/\s+/g, " ").trim();
  if (!loc || loc === "unknown" || loc === "null" || loc === "undefined") {
    const src = String(source || "").toLowerCase();
    return src.includes("naukri") || src.includes("internshala");
  }

  const indiaAliases = Array.isArray(config.india_locations) && config.india_locations.length > 0
    ? config.india_locations.map((a) => a.toLowerCase().trim())
    : DEFAULT_INDIA_ALIASES;

  const hasIndiaAlias = indiaAliases.some((alias) => {
    const regex = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    return regex.test(loc);
  });
  if (hasIndiaAlias) {
    return true;
  }

  for (const foreign of NON_INDIA_REGIONS) {
    const regex = new RegExp(`\\b${foreign.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(loc)) {
      return false;
    }
  }

  const isPlainRemote = /\b(remote|anywhere|worldwide|global|apac)\b/i.test(loc);
  if (isPlainRemote) {
    const allowUnrestricted = config.allow_unrestricted_remote ?? true;
    return Boolean(allowUnrestricted);
  }

  const src = String(source || "").toLowerCase();
  return src.includes("naukri") || src.includes("internshala");
}
