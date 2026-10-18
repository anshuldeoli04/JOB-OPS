const SCAN_RESULT_LIMIT = 25;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

export function truncateText(value, limit) {
  const normalized = normalizeText(value);
  if (normalized.length <= limit) return normalized;
  if (limit <= 3) return '.'.repeat(limit);
  return `${normalized.slice(0, limit - 3)}...`;
}

export function formatScanIndex(index) {
  return String(index + 1).padStart(2, '0');
}

export function formatScanDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('en-IN');
}

export function buildVisibleScanRows(rows = [], page = 1, pageSize = SCAN_RESULT_LIMIT) {
  // Backward compatibility: if 2nd arg is just limit
  let startIndex = 0;
  let endIndex = SCAN_RESULT_LIMIT;
  if (arguments.length === 2 && typeof page === 'number') {
    endIndex = page;
  } else {
    startIndex = Math.max((page - 1) * pageSize, 0);
    endIndex = startIndex + pageSize;
  }

  return rows.slice(startIndex, endIndex).map((item, index) => ({
    ...item,
    displayIndex: formatScanIndex(startIndex + index),
    displayCompany: normalizeText(item.company || 'Unknown'),
    displayTitle: normalizeText(item.role || 'Unknown'),
    displaySource: normalizeText(item.source || 'manual'),
    displayLocation: normalizeText(item.location || '-'),
    displayDate: formatScanDate(item.posted || item.scanned_at),
  }));
}

export function isScanTableLine(line = '') {
  const text = String(line || '');
  return (
    /^S\.No\s+\|/.test(text) ||
    /^-{8,}$/.test(text) ||
    /^\d{2}\s+\|/.test(text) ||
    /^Showing \d+ of \d+ jobs$/.test(text) ||
    /^Tip: 'all' ya 'auto'/.test(text) ||
    /^Experience-matched unevaluated jobs/.test(text)
  );
}

export function getScanResultLimit() {
  return SCAN_RESULT_LIMIT;
}
