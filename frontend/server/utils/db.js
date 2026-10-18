import pg from 'pg';
import { loadLocalEnv } from './loadEnv.js';

loadLocalEnv();

const { Pool } = pg;

const required = ['DB_HOST', 'DB_USER', 'DB_NAME'];

for (const key of required) {
  if (!process.env[key]) {
    console.warn(`[job-ops] Missing ${key}. PostgreSQL routes will fail until env is configured.`);
  }
}

export const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'jobops',
  max: Number(process.env.DB_POOL_SIZE || 10),
});

// Helper to find closing parenthesis index accounting for nesting
function findMatchingParen(str, openIndex) {
  let depth = 1;
  let inString = false;
  let stringChar = '';
  for (let i = openIndex + 1; i < str.length; i++) {
    const char = str[i];
    if (!inString && (char === "'" || char === '"')) {
      inString = true;
      stringChar = char;
    } else if (inString && char === stringChar && str[i - 1] !== '\\') {
      inString = false;
    } else if (!inString) {
      if (char === '(') depth++;
      else if (char === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
  }
  return -1;
}

/**
 * @deprecated Legacy query translation shim. Deprecated in ARCH-2.
 * All application queries use native PostgreSQL syntax with parameterized values ($1, $2).
 */
export function translateQuery(sql, params) {
  let text = String(sql || '').trim();

  // 1. Convert JSON_ARRAYAGG with balanced parenthesis matching
  let arrayAggMatch;
  while ((arrayAggMatch = /JSON_ARRAYAGG\s*\(/i.exec(text)) !== null) {
    const start = arrayAggMatch.index;
    const parenStart = start + arrayAggMatch[0].length - 1;
    const parenEnd = findMatchingParen(text, parenStart);
    if (parenEnd === -1) break;
    const inner = text.slice(parenStart + 1, parenEnd);
    text = text.slice(0, start) + `COALESCE(json_agg(${inner}), json_build_array())` + text.slice(parenEnd + 1);
  }
  text = text.replace(/JSON_ARRAY\s*\(\)/gi, 'json_build_array()');

  // 2. Convert JSON_OBJECT with balanced parenthesis matching
  let objMatch;
  while ((objMatch = /JSON_OBJECT\s*\(/i.exec(text)) !== null) {
    const start = objMatch.index;
    const parenStart = start + objMatch[0].length - 1;
    const parenEnd = findMatchingParen(text, parenStart);
    if (parenEnd === -1) break;
    const argsStr = text.slice(parenStart + 1, parenEnd);
    
    // Split on top-level commas only
    const parts = [];
    let cur = '';
    let depth = 0;
    let inStr = false;
    for (let c of argsStr) {
      if (c === "'" || c === '"') inStr = !inStr;
      if (!inStr && c === '(') depth++;
      if (!inStr && c === ')') depth--;
      if (!inStr && depth === 0 && c === ',') {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += c;
      }
    }
    if (cur.trim()) parts.push(cur.trim());

    const transformed = [];
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const val = parts[i];
        if (val === '?' || val.startsWith(':')) {
          transformed.push(`CAST(${val} AS text)`);
        } else {
          transformed.push(val);
        }
      } else {
        transformed.push(parts[i]);
      }
    }
    text = text.slice(0, start) + `jsonb_build_object(${transformed.join(', ')})` + text.slice(parenEnd + 1);
  }

  // 3. Convert MySQL ON DUPLICATE KEY UPDATE to PostgreSQL ON CONFLICT (id) DO UPDATE SET
  const onConflictMarker = 'ON CONFLICT (id) DO UPDATE SET';
  text = text.replace(/ON\s+DUPLICATE\s+KEY\s+UPDATE/gi, onConflictMarker);
  const conflictIndex = text.indexOf(onConflictMarker);
  if (conflictIndex !== -1) {
    const beforeConflict = text.slice(0, conflictIndex + onConflictMarker.length);
    const afterConflict = text.slice(conflictIndex + onConflictMarker.length);
    const fixedAfter = afterConflict.replace(/VALUES\s*\(\s*([a-zA-Z0-9_]+)\s*\)/gi, 'EXCLUDED.$1');
    text = beforeConflict + fixedAfter;
  }

  // 4. Handle parameters
  const values = [];
  if (Array.isArray(params)) {
    let index = 1;
    text = text.replace(/\?/g, () => `$${index++}`);
    values.push(...params);
  } else if (params && typeof params === 'object') {
    const paramMap = new Map();
    text = text.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, paramName) => {
      if (!paramMap.has(paramName)) {
        values.push(params[paramName]);
        paramMap.set(paramName, values.length);
      }
      return `$${paramMap.get(paramName)}`;
    });
  }

  if (/^\s*INSERT\s+INTO\b/i.test(text) && !/\bRETURNING\b/i.test(text)) {
    text += ' RETURNING id';
  }

  return { text, values };
}

/**
 * Normalizes parameterized query directly without regex AST/syntax translation shims.
 */
function prepareNativeQuery(sql, params) {
  let text = String(sql || '').trim();
  const values = [];

  if (Array.isArray(params)) {
    let index = 1;
    text = text.replace(/\?/g, () => `$${index++}`);
    values.push(...params);
  } else if (params && typeof params === 'object') {
    const paramMap = new Map();
    text = text.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, paramName) => {
      if (!paramMap.has(paramName)) {
        values.push(params[paramName]);
        paramMap.set(paramName, values.length);
      }
      return `$${paramMap.get(paramName)}`;
    });
  }

  if (/^\s*INSERT\s+INTO\b/i.test(text) && !/\bRETURNING\b/i.test(text)) {
    text += ' RETURNING id';
  }

  return { text, values };
}

export async function query(sql, params = []) {
  const { text, values } = prepareNativeQuery(sql, params);
  try {
    const res = await pool.query(text, values);
    const rows = res.rows || [];
    const isInsert = /^\s*INSERT\s+INTO\b/i.test(text);
    if (isInsert && rows[0]?.id !== undefined) {
      rows.insertId = rows[0].id;
    }
    rows.rowCount = res.rowCount;
    rows.affectedRows = res.rowCount;
    return rows;
  } catch (err) {
    err.message = `DB query failed: ${err.message}\nSQL: ${text}`;
    throw err;
  }
}

export async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    client.execute = async (sql, params = []) => {
      const { text, values } = prepareNativeQuery(sql, params);
      const res = await client.query(text, values);
      const rows = res.rows || [];
      const isInsert = /^\s*INSERT\s+INTO\b/i.test(text);
      if (isInsert && rows[0]?.id !== undefined) {
        rows.insertId = rows[0].id;
      }
      rows.rowCount = res.rowCount;
      rows.affectedRows = res.rowCount;
      const meta = {
        insertId: rows.insertId,
        rowCount: res.rowCount,
        affectedRows: res.rowCount
      };
      return [rows, meta];
    };

    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

