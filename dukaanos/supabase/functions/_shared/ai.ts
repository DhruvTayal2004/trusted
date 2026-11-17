/**
 * AI provider abstraction. Runs ONLY inside edge functions (keys never reach the phone).
 *
 *   AI_PROVIDER=anthropic → Claude via the official SDK (default model claude-opus-5-5)
 *   AI_PROVIDER=openai    → OpenAI chat completions (+ Whisper for speech)
 *   no keys               → NoneProvider: every call throws AiNotConfigured, and the app shows "AI not connected"
 *
 * Every method returns JSON validated against a schema the caller supplies; the model is never
 * trusted to produce numbers that end up in ledgers without human review (see ai-extract).
 */
import Anthropic from 'npm:@anthropic-ai/sdk@^0.80.0';
import { env } from './supabase.ts';

export interface JsonSchema { type: 'object'; properties: Record<string, unknown>; required?: string[]; additionalProperties?: false; [k: string]: unknown }

export interface ExtractImageArgs { system: string; prompt: string; imageBase64: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; schema: JsonSchema; maxTokens?: number }
export interface ChatArgs { system: string; messages: { role: 'user' | 'assistant'; content: string }[]; schema?: JsonSchema; maxTokens?: number }
export interface TranscribeArgs { audioBytes: Uint8Array; mimeType: string; language?: string; prompt?: string }

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  extractFromImage(a: ExtractImageArgs): Promise<unknown>;
  chat(a: ChatArgs): Promise<{ text: string; json: unknown | null }>;
  transcribe(a: TranscribeArgs): Promise<string>;
}

export class AiNotConfigured extends Error {
  constructor(msg = 'AI is not connected. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in the Supabase function secrets.') {
    super(msg);
  }
}

// ---------------------------------------------------------------------------
// Anthropic (Claude)
// ---------------------------------------------------------------------------
class AnthropicProvider implements AiProvider {
  name = 'anthropic';
  model: string;
  private client: Anthropic;
  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async extractFromImage(a: ExtractImageArgs): Promise<unknown> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: a.maxTokens ?? 16000,
      system: a.system,
      output_config: { format: { type: 'json_schema', schema: a.schema } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: a.mimeType, data: a.imageBase64 } },
          { type: 'text', text: a.prompt },
        ],
      }],
    });
    if (res.stop_reason === 'refusal') throw new Error('Model declined to process this image');
    if (res.stop_reason === 'max_tokens') throw new Error('Page too dense: output was cut off. Photograph half the page at a time.');
    return parseJsonFromBlocks(res.content);
  }

  async chat(a: ChatArgs): Promise<{ text: string; json: unknown | null }> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: a.maxTokens ?? 4000,
      system: a.system,
      ...(a.schema ? { output_config: { format: { type: 'json_schema', schema: a.schema } } } : {}),
      messages: a.messages,
    });
    if (res.stop_reason === 'refusal') throw new Error('Model declined this request');
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    return { text, json: a.schema ? safeParse(text) : null };
  }

  async transcribe(_a: TranscribeArgs): Promise<string> {
    // Claude has no speech endpoint. Use OpenAI Whisper when its key exists, else tell the client to type.
    const key = env('OPENAI_API_KEY');
    if (!key) throw new AiNotConfigured('Speech-to-text needs OPENAI_API_KEY (Whisper). Type the order instead.');
    return openaiTranscribe(key, _a);
  }
}

function parseJsonFromBlocks(content: Anthropic.ContentBlock[]): unknown {
  const text = content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
  const parsed = safeParse(text);
  if (parsed === null) throw new Error('Model did not return valid JSON');
  return parsed;
}

function safeParse(text: string): unknown | null {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { return null; } }
  return null;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
class OpenAIProvider implements AiProvider {
  name = 'openai';
  constructor(private apiKey: string, public model: string) {}

  private async complete(body: Record<string, unknown>): Promise<string> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, ...body }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content ?? '';
  }

  async extractFromImage(a: ExtractImageArgs): Promise<unknown> {
    const text = await this.complete({
      max_completion_tokens: a.maxTokens ?? 16000,
      response_format: { type: 'json_schema', json_schema: { name: 'extraction', strict: true, schema: a.schema } },
      messages: [
        { role: 'system', content: a.system },
        { role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${a.mimeType};base64,${a.imageBase64}`, detail: 'high' } }, { type: 'text', text: a.prompt }] },
      ],
    });
    const parsed = safeParse(text);
    if (parsed === null) throw new Error('Model did not return valid JSON');
    return parsed;
  }

  async chat(a: ChatArgs): Promise<{ text: string; json: unknown | null }> {
    const text = await this.complete({
      max_completion_tokens: a.maxTokens ?? 4000,
      ...(a.schema ? { response_format: { type: 'json_schema', json_schema: { name: 'reply', strict: true, schema: a.schema } } } : {}),
      messages: [{ role: 'system', content: a.system }, ...a.messages],
    });
    return { text, json: a.schema ? safeParse(text) : null };
  }

  transcribe(a: TranscribeArgs): Promise<string> {
    return openaiTranscribe(this.apiKey, a);
  }
}

async function openaiTranscribe(apiKey: string, a: TranscribeArgs): Promise<string> {
  const form = new FormData();
  const ext = a.mimeType.includes('mp4') || a.mimeType.includes('m4a') ? 'm4a' : a.mimeType.includes('webm') ? 'webm' : a.mimeType.includes('wav') ? 'wav' : 'mp3';
  form.append('file', new Blob([a.audioBytes as BlobPart], { type: a.mimeType }), `audio.${ext}`);
  form.append('model', env('OPENAI_TRANSCRIBE_MODEL', 'whisper-1'));
  if (a.language) form.append('language', a.language);
  if (a.prompt) form.append('prompt', a.prompt);
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form });
  if (!res.ok) throw new Error(`Transcription error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return String(data.text ?? '');
}

// ---------------------------------------------------------------------------
class NoneProvider implements AiProvider {
  name = 'none';
  model = 'none';
  extractFromImage(): Promise<unknown> { return Promise.reject(new AiNotConfigured()); }
  chat(): Promise<{ text: string; json: unknown | null }> { return Promise.reject(new AiNotConfigured()); }
  transcribe(): Promise<string> { return Promise.reject(new AiNotConfigured()); }
}

export function getProvider(): AiProvider {
  const pref = env('AI_PROVIDER', 'anthropic').toLowerCase();
  const anthropicKey = env('ANTHROPIC_API_KEY');
  const openaiKey = env('OPENAI_API_KEY');
  if (pref === 'openai' && openaiKey) return new OpenAIProvider(openaiKey, env('OPENAI_MODEL', 'gpt-5.2'));
  if (anthropicKey) return new AnthropicProvider(anthropicKey, env('ANTHROPIC_MODEL', 'claude-opus-5-5'));
  if (openaiKey) return new OpenAIProvider(openaiKey, env('OPENAI_MODEL', 'gpt-5.2'));
  return new NoneProvider();
}

export function isConfigured(): boolean {
  return getProvider().name !== 'none';
}
