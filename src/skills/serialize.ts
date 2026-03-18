/**
 * Skills Sync Serialization
 *
 * Ensures that concurrent skill operations with the same key execute
 * sequentially. Inspired by OpenClaw's serialize.ts.
 */

const SKILLS_SYNC_QUEUE = new Map<string, Promise<unknown>>();

/**
 * Run `task` serially per `key`. If another task with the same key
 * is in-flight, this waits for it to finish before starting.
 */
export async function serializeByKey<T>(
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = SKILLS_SYNC_QUEUE.get(key) ?? Promise.resolve();
  const next = previous.then(task, task);
  SKILLS_SYNC_QUEUE.set(key, next);
  try {
    return await next;
  } finally {
    if (SKILLS_SYNC_QUEUE.get(key) === next) {
      SKILLS_SYNC_QUEUE.delete(key);
    }
  }
}
