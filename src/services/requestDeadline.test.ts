// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, CoreApiError, dataApi } from './coreApi';
import { authApi, UNAUTHORIZED_EVENT } from './authApi';
import { AI_REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS, RequestTimeoutError, withRequestDeadline } from './requestDeadline';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const never = () => new Promise<never>(() => {});

describe('bounded API waits', () => {
  it('aborts a stalled write without claiming a server refusal or retrying it', async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn((_url: string, init?: RequestInit) => { signal = init?.signal ?? undefined; return never(); });
    vi.stubGlobal('fetch', fetch);
    const pending = dataApi.sync({ upserts: { workItems: [{ id: 'synthetic-item' }] }, deletes: {} });
    const refused = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await refused;
    expect(signal?.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('also bounds a response that sends headers but never finishes its body', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: never })));
    const refused = expect(api.get('/data/snapshot')).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await refused;
  });
  it('cleans up its deadline after a normal response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ id: 'synthetic' }))));
    await expect(api.get('/projects/synthetic')).resolves.toEqual({ id: 'synthetic' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not treat an HTML success page as confirmation that a write succeeded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>App shell</html>', { status: 200 })));
    const result = dataApi.sync({ upserts: {}, deletes: {} });
    await expect(result).rejects.toThrow('outcome is unconfirmed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a legitimate no-content response successful', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
    await expect(api.delete('/synthetic-record')).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains explicit validation refusals and does not misclassify them as timeouts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'validation_error', message: 'Synthetic refusal' }), { status: 400 })));
    await expect(api.post('/data/sync')).rejects.toMatchObject({ status: 400, code: 'validation_error', message: 'Synthetic refusal' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains the session-ended event for an unauthenticated response', async () => {
    const ended = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, ended);
    try {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
      await expect(api.get('/projects')).rejects.toBeInstanceOf(CoreApiError);
      expect(ended).toHaveBeenCalledOnce();
    } finally { window.removeEventListener(UNAUTHORIZED_EVENT, ended); }
  });
  it('allows the longer AI processing budget while still bounding it', async () => {
    vi.stubGlobal('fetch', vi.fn(never));
    let settled = false;
    const pending = api.post('/ai/ops/chat').finally(() => { settled = true; });
    const refused = expect(pending).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(AI_REQUEST_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await refused;
  });
  it('cleans up after a synchronous transport failure', async () => {
    await expect(withRequestDeadline(() => { throw new Error('Synthetic network failure'); })).rejects.toThrow('Synthetic network failure');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('bounded authentication waits', () => {
  it('releases a stalled initial session check', async () => {
    vi.stubGlobal('fetch', vi.fn(never));
    const refused = expect(authApi.session()).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await refused;
  });
  it('releases sign-in even when the response body stalls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: never })));
    const refused = expect(authApi.login('synthetic@example.test', 'synthetic-only')).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await refused;
  });
});
