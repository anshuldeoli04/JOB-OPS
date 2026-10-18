import { ensureJsonFile, readJson, writeJson } from './fileDb.js';

const activityFile = new URL('../data/activity.json', import.meta.url);

await ensureJsonFile(activityFile, [
  {
    id: 'seed-1',
    title: 'Frontend scaffold bootstrapped',
    description: 'React shell, auth, settings, and bridge server contract added.',
    timestamp: new Date().toISOString()
  }
]);

let activityWriteQueue = Promise.resolve();

export async function readActivity() {
  return readJson(activityFile, []);
}

export async function appendActivity(entry) {
  const task = async () => {
    const activity = await readJson(activityFile, []);
    const next = [
      {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        ...entry
      },
      ...activity
    ].slice(0, 50);
    await writeJson(activityFile, next);
    return next;
  };

  const nextPromise = activityWriteQueue.then(task, task);
  activityWriteQueue = nextPromise.catch(() => {});
  return nextPromise;
}
