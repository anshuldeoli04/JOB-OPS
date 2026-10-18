export function toPublicFileUrl(filePath) {
  if (!filePath) return null;
  let normalized = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');

  // Strip drive letters / parent directories if an absolute path was passed
  const outputIdx = normalized.indexOf('output/');
  const reportsIdx = normalized.indexOf('reports/');
  if (outputIdx !== -1) {
    normalized = normalized.slice(outputIdx);
  } else if (reportsIdx !== -1) {
    normalized = normalized.slice(reportsIdx);
  }
  if (process.env.APP_BASE_URL) {
    const base = process.env.APP_BASE_URL.replace(/\/+$/, '');
    return `${base}/files/${normalized}`;
  }
  return `/files/${normalized}`;
}
