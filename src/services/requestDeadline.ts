export const REQUEST_TIMEOUT_MS = 60_000;
export const AI_REQUEST_TIMEOUT_MS = 120_000;

/** A browser deadline does not establish whether a server-side write committed. */
export class RequestTimeoutError extends Error {
  constructor() {
    super('The server did not respond in time. It may still be processing the request.');
    this.name = 'RequestTimeoutError';
  }
}

/** Covers response headers and body; never retries a potentially committed operation. */
export async function withRequestDeadline<T>(perform: (signal: AbortSignal) => Promise<T>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new RequestTimeoutError();
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve().then(() => perform(controller.signal)), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
