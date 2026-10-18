const userQueues = new Map();

export function withUserWorkspaceLock(userId, task) {
  const key = String(userId || 'global');
  const previousQueue = userQueues.get(key) || Promise.resolve();
  const run = previousQueue.then(task, task);
  userQueues.set(key, run.catch(() => {}));
  return run;
}

export function withWorkspaceLock(_userId, task) {
  // Enforce a global lock because CLI worker scripts share root .env, cv.md, and config.local.json
  const callback = typeof _userId === 'function' ? _userId : task;
  return withUserWorkspaceLock('global', callback);
}
