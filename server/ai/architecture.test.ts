/**
 * Architecture guard (Phase 6 Batch 7): the only production path to a language model is
 *
 *   browser → authenticated NW OS API → permission checks → context builder → AI gateway → provider
 *
 * These checks make it hard to add "route → provider SDK" by accident. They read the source
 * tree (and the built bundle when one exists); they do not depend on any model.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', 'dist', '.git', 'out']);
function files(dir: string, exts = ['.ts', '.tsx', '.js', '.cjs', '.mjs']): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...files(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}
const rel = (p: string) => path.relative(ROOT, p).split(path.sep).join('/');
const source = (files(ROOT).filter((f) => !rel(f).startsWith('scripts/acceptance/out')) as string[]).map((f) => ({ file: rel(f), text: fs.readFileSync(f, 'utf8') }));
const isTest = (f: string) => /\.test\.tsx?$/.test(f);

/** Provider SDKs and raw provider endpoints. */
const PROVIDER_SDK = /from\s+['"](@google\/genai|@google\/generative-ai|openai|@anthropic-ai\/sdk|@mistralai\/[^'"]+|cohere-ai|ollama)['"]|require\(\s*['"](@google\/genai|@google\/generative-ai|openai|@anthropic-ai\/sdk)['"]\s*\)/;
const PROVIDER_CALL = /\.generateContent(Stream)?\s*\(|generativelanguage\.googleapis\.com|api\.openai\.com|api\.anthropic\.com|new\s+GoogleGenAI\s*\(/;

describe('AI architecture: the gateway is the only way to a model', () => {
  it('only server/ai/provider.ts imports a provider SDK or calls a model API', () => {
    const offenders = source.filter((s) => !isTest(s.file) && s.file !== 'server/ai/provider.ts' && (PROVIDER_SDK.test(s.text) || PROVIDER_CALL.test(s.text))).map((s) => s.file);
    expect(offenders).toEqual([]);
  });

  it('only the gateway constructs providers; routes and features go through it', () => {
    const importsProvider = source.filter((s) => !isTest(s.file) && s.file !== 'server/ai/provider.ts' && /from\s+['"][./]*(ai\/)?provider['"]/.test(s.text)).map((s) => s.file);
    expect(importsProvider).toEqual(['server/ai/gateway.ts']);
    const constructs = source.filter((s) => !isTest(s.file) && s.file !== 'server/ai/provider.ts' && /new\s+(GeminiProvider|MockProvider)\s*\(|providerFromEnv\s*\(/.test(s.text)).map((s) => s.file);
    expect(constructs).toEqual(['server/ai/gateway.ts']);
    // The gateway is only driven by the AI service (features), never by route handlers directly.
    const gatewayUsers = source.filter((s) => !isTest(s.file) && /new\s+AIGateway\s*\(/.test(s.text)).map((s) => s.file);
    expect(gatewayUsers).toEqual(['server/ai/service.ts']);
  });

  it('server.ts mounts the API and serves the app; it has no AI handlers or provider code', () => {
    const server = source.find((s) => s.file === 'server.ts')!.text;
    expect(server).not.toMatch(/genai|Gemini|generateContent|GEMINI_API_KEY/);
    expect(server).not.toMatch(/app\.(post|get|put|patch|delete)\(\s*['"]\/api\/(ai|gateway)/);
  });

  it('the legacy rule-based routes never call a model', () => {
    const rules = source.find((s) => s.file === 'server/ai/legacyRules.ts')!.text;
    expect(rules).not.toMatch(/import[^\n]*['"]\.\/(gateway|service|provider|legacy)['"]|new\s+(AIGateway|AIService)\s*\(|aiRuntime\s*\(|GoogleGenAI|generateContent|process\.env\.GEMINI/);
  });

  it('browser code has no provider SDK, key, provider configuration or build-time env exposure', () => {
    const browser = source.filter((s) => s.file.startsWith('src/') || s.file === 'vite.config.ts' || s.file === 'index.html');
    const bad = browser.filter((s) => PROVIDER_SDK.test(s.text) || PROVIDER_CALL.test(s.text) || /GEMINI_API_KEY|GOOGLE_API_KEY|AI_PROVIDER|AI_MODEL|import\.meta\.env\.(?!MODE|DEV|PROD|SSR|BASE_URL)/.test(s.text)).map((s) => s.file);
    expect(bad).toEqual([]);
    // Vite exposes only VITE_* env to the browser; nothing defines or renames that prefix.
    const vite = fs.readFileSync(path.join(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).not.toMatch(/\bdefine\s*:|envPrefix|loadEnv/);
    expect(fs.existsSync(path.join(ROOT, '.env.example')) ? fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8') : '').not.toMatch(/^VITE_.*(KEY|SECRET|TOKEN)/m);
  });

  it('a built browser bundle (when present) carries no provider SDK, endpoint or key', () => {
    const assets = path.join(ROOT, 'dist', 'assets');
    if (!fs.existsSync(assets)) return; // not built in this run
    const bundle = fs.readdirSync(assets).filter((f) => f.endsWith('.js')).map((f) => fs.readFileSync(path.join(assets, f), 'utf8')).join('\n');
    expect(bundle).not.toMatch(/generativelanguage\.googleapis\.com|GoogleGenAI|GEMINI_API_KEY|@google\/genai/);
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== 'MY_GEMINI_API_KEY') expect(bundle.includes(key)).toBe(false);
  });
});
