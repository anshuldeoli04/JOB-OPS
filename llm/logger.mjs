export function isVerbose() {
  return (
    process.argv.includes("--verbose") ||
    process.env.VERBOSE === "true" ||
    process.env.VERBOSE === "1"
  );
}

export function logLLM(...args) {
  if (isVerbose()) {
    console.error(...args);
  }
}
