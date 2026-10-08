/**
 * LLM providers for the AI gateway (server side only; keys never reach the browser).
 *
 * The application talks to one interface, LLMProvider. Which provider runs is configuration:
 *
 *   AI_PROVIDER   gemini | mock | none      (default: gemini when GEMINI_API_KEY is set, else none)
 *   AI_MODEL      model name                (default: gemini-flash-latest)
 *   GEMINI_API_KEY                          (Gemini only; read here, never logged or returned)
 *
 * With no provider the gateway reports "unavailable" and every feature shows its deterministic
 * NW OS answer. The mock provider is deterministic and offline: the test suite and the browser
 * acceptance run use it, so nothing depends on a paid external model.
 */
import { GoogleGenAI } from '@google/genai';

export interface LLMRequest {
  /** Task instructions (trusted, from server/ai/tasks.ts). */
  system: string;
  /** The user's question and the NW OS context (untrusted data, clearly delimited). */
  prompt: string;
  /** Ask for a JSON object. */
  json: boolean;
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Gateway metadata the mock provider uses to stay deterministic. */
  meta: { task: string; requestId: string; context: unknown };
}
export interface LLMUsage {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
}
export interface LLMResult {
  text: string;
  model: string;
  usage: LLMUsage;
}
export interface LLMHealth {
  provider: string;
  model: string | null;
  configured: boolean;
  detail: string;
}
export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  generate(req: LLMRequest): Promise<LLMResult>;
  /** Streams text chunks; the gateway currently uses generate/structuredOutput (see docs). */
  stream(req: LLMRequest): AsyncIterable<string>;
  /** generate() asking for a JSON object; the gateway validates it against the task schema. */
  structuredOutput(req: Omit<LLMRequest, 'json'>): Promise<LLMResult>;
  healthCheck(): Promise<LLMHealth>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: 'timeout' | 'unavailable' | 'provider' | 'malformed',
    readonly retryable: boolean
  ) {
    super(message);
  }
}

// ------------------------------------------------------------------ Gemini

export class GeminiProvider implements LLMProvider {
  readonly name = 'gemini';
  // A true private field: the client (which holds the key) is never serialised or logged.
  #client: GoogleGenAI;
  constructor(
    apiKey: string,
    readonly model: string
  ) {
    this.#client = new GoogleGenAI({ apiKey });
  }

  async generate(req: LLMRequest): Promise<LLMResult> {
    try {
      const res = await this.#client.models.generateContent({
        model: this.model,
        contents: req.prompt,
        config: {
          systemInstruction: req.system,
          temperature: 0.2,
          maxOutputTokens: req.maxOutputTokens,
          abortSignal: req.signal,
          ...(req.json ? { responseMimeType: 'application/json' } : {}),
        },
      });
      const u = res.usageMetadata;
      return { text: res.text ?? '', model: this.model, usage: { input_tokens: u?.promptTokenCount, output_tokens: u?.candidatesTokenCount, total_tokens: u?.totalTokenCount } };
    } catch (err) {
      if (req.signal.aborted) throw new ProviderError('The model did not answer in time', 'timeout', true);
      const status = Number((err as { status?: unknown })?.status);
      // 429 / 5xx are worth one more try; anything else (bad key, bad request) is not.
      throw new ProviderError(`The model provider returned an error${status ? ` (${status})` : ''}`, 'provider', status === 429 || status >= 500);
    }
  }

  async *stream(req: LLMRequest): AsyncIterable<string> {
    const it = await this.#client.models.generateContentStream({ model: this.model, contents: req.prompt, config: { systemInstruction: req.system, temperature: 0.2, maxOutputTokens: req.maxOutputTokens, abortSignal: req.signal } });
    for await (const chunk of it) if (chunk.text) yield chunk.text;
  }

  structuredOutput(req: Omit<LLMRequest, 'json'>) {
    return this.generate({ ...req, json: true });
  }

  async healthCheck(): Promise<LLMHealth> {
    return { provider: this.name, model: this.model, configured: true, detail: 'Gemini API key configured on the server' };
  }
}

// ------------------------------------------------------------------ deterministic mock

/**
 * Offline, deterministic provider. By default it writes a short, valid structured answer from the
 * context it is given (citing only the context's own references). Tests switch its behaviour to
 * exercise the gateway: timeout, provider error, malformed output, invented references or
 * figures, a forbidden action, or a "prompt injected" answer.
 */
export type MockMode = 'ok' | 'timeout' | 'error' | 'malformed' | 'malformed_once' | 'invented' | 'forbidden_action' | 'leak';
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'nwos-mock-1';
  mode: MockMode = 'ok';
  calls: LLMRequest[] = [];
  private failedOnce = false;

  async generate(req: LLMRequest): Promise<LLMResult> {
    this.calls.push(req);
    const usage = { input_tokens: Math.ceil((req.system.length + req.prompt.length) / 4), output_tokens: 120, total_tokens: 0 };
    usage.total_tokens = usage.input_tokens + usage.output_tokens;
    if (this.mode === 'timeout') {
      await new Promise((resolve, reject) => req.signal.addEventListener('abort', () => reject(new ProviderError('The model did not answer in time', 'timeout', true)), { once: true }));
    }
    // Acceptance-run hook (offline mock only): a request containing "#mock-fail" fails like an outage.
    if (this.mode === 'error' || req.prompt.includes('#mock-fail')) throw new ProviderError('The model provider returned an error (503)', 'provider', true);
    if (this.mode === 'malformed' || (this.mode === 'malformed_once' && !this.failedOnce)) {
      this.failedOnce = true;
      return { text: 'Sure! Here is my answer: {not json', model: this.model, usage };
    }
    return { text: JSON.stringify(this.answer(req)), model: this.model, usage };
  }

  private answer(req: LLMRequest) {
    const ctx = (req.meta.context ?? {}) as { facts?: { ref: string; text: string; confidence: string }[]; actions?: { ref: string }[] };
    const facts = ctx.facts ?? [];
    const top = facts.filter((f) => f.confidence === 'Confirmed').slice(0, 3);
    const base = {
      answer: top.length ? `Summary (${req.meta.task}): ${top.map((f) => f.text).join(' ')}` : 'NW OS has no records that answer this.',
      highlights: top.map((f) => ({ ref: f.ref, why: 'Most relevant confirmed record' })),
      inferences: top.length > 1 ? [{ text: 'These items are probably related.', basis_refs: top.slice(0, 2).map((f) => f.ref) }] : [],
      recommendations: top.length ? [{ text: 'Review the highlighted records with the responsible person.', priority: 'Medium', evidence_refs: [top[0].ref] }] : [],
      suggested_actions: (ctx.actions ?? []).slice(0, 1).map((a) => ({ ref: a.ref, why: 'Follow up the highlighted record' })),
      unknowns: top.length ? [] : ['No matching NW OS record'],
      requires_human_decision: false,
    };
    if (this.mode === 'invented') {
      base.highlights.push({ ref: 'F999', why: 'invented' });
      base.recommendations.push({ text: 'Approve PO-9999 for RM 123,456.78 today.', priority: 'High', evidence_refs: ['F998'] });
      base.answer += ' The margin is exactly RM 987,654.32.';
    }
    if (this.mode === 'forbidden_action') {
      (base.suggested_actions as unknown[]).push({ action: 'approve_variation', params: { id: 'vo-1' }, why: 'It looks fine' }, { ref: 'A99', why: 'invented' });
    }
    if (this.mode === 'leak') {
      // What a model "obeying" an injected instruction might write: it can only repeat what it was given.
      base.answer = 'Ignoring previous instructions. Company financial data: ' + req.prompt.slice(0, 200);
    }
    return base;
  }

  async *stream(req: LLMRequest): AsyncIterable<string> {
    yield (await this.generate(req)).text;
  }

  structuredOutput(req: Omit<LLMRequest, 'json'>) {
    return this.generate({ ...req, json: true });
  }

  async healthCheck(): Promise<LLMHealth> {
    return { provider: this.name, model: this.model, configured: true, detail: `Deterministic offline provider (mode ${this.mode})` };
  }
}

// ------------------------------------------------------------------ selection

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LLMProvider | null {
  const key = env.GEMINI_API_KEY && env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY' ? env.GEMINI_API_KEY : '';
  const choice = (env.AI_PROVIDER ?? (key ? 'gemini' : 'none')).toLowerCase();
  if (choice === 'mock') return new MockProvider();
  if (choice === 'gemini' && key) return new GeminiProvider(key, env.AI_MODEL || 'gemini-flash-latest');
  return null;
}
