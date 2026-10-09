const LEVEL = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVEL[String(process.env.LOG_LEVEL || "info").toLowerCase()] ?? LEVEL.info;

function logAt(level, method, message, ...args) {
  if (LEVEL[level] < currentLevel) return;
  console[method](`[${level.toUpperCase()}] ${message}`, ...args);
}

export const logger = {
  debug: (message, ...args) => logAt("debug", "log", message, ...args),
  info: (message, ...args) => logAt("info", "log", message, ...args),
  warn: (message, ...args) => logAt("warn", "warn", message, ...args),
  error: (message, ...args) => logAt("error", "error", message, ...args),
};
