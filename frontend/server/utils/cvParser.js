import pdfParse from 'pdf-parse';

function normalizeLine(line) {
  return line
    .replace(/\u2022/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function isLikelyHeading(line) {
  if (!line) return false;
  if (line.length > 60) return false;
  if (/^(summary|education|skills|work experience|experience|projects|certifications|achievements|languages)$/i.test(line)) {
    return true;
  }
  return /^[A-Z][A-Z\s/&-]{2,}$/.test(line);
}

export function normalizeCvText(rawText) {
  const lines = String(rawText || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(normalizeLine)
    .filter(Boolean);

  const normalized = [];
  let previousWasHeading = false;

  for (const line of lines) {
    const bulletLine = /^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line);
    const headingLine = isLikelyHeading(line);

    if (headingLine) {
      if (normalized.length && normalized[normalized.length - 1] !== '') normalized.push('');
      normalized.push(`## ${line.replace(/^#+\s*/, '')}`);
      normalized.push('');
      previousWasHeading = true;
      continue;
    }

    if (bulletLine) {
      normalized.push(line.replace(/^[-*]\s*/, '- '));
      previousWasHeading = false;
      continue;
    }

    if (!previousWasHeading && normalized.length && normalized[normalized.length - 1] && !normalized[normalized.length - 1].startsWith('- ') && line.length < 80) {
      normalized[normalized.length - 1] = `${normalized[normalized.length - 1]} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      normalized.push(line);
    }
    previousWasHeading = false;
  }

  return normalized
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractTextFromPdfBuffer(buffer) {
  const parsed = await pdfParse(buffer);
  return normalizeCvText(parsed.text || '');
}
