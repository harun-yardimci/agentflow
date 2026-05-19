import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '../db/connection.js';
import { getProviderKey, getModelCliFlag } from '../lib/provider-utils.js';
import type { BaseExecutor, ExecutorInput, ExecutorResult } from './types.js';

interface ProviderApiConfig {
  executionMode: 'cli' | 'api';
  apiKey: string | null;
}

function getProviderApiConfig(providerKey: string): ProviderApiConfig {
  const db = getDb();
  const row = db
    .prepare('SELECT execution_mode, api_key FROM providers WHERE id = ?')
    .get(providerKey) as { execution_mode: string; api_key: string | null } | undefined;
  return {
    executionMode: row?.execution_mode === 'api' ? 'api' : 'cli',
    apiKey: row?.api_key ?? null,
  };
}

export function shouldUseApiExecutor(model: string): boolean {
  const providerKey = getProviderKey(model);
  const cfg = getProviderApiConfig(providerKey);
  return cfg.executionMode === 'api' && !!cfg.apiKey;
}

export class APIExecutor implements BaseExecutor {
  readonly type = 'api';
  private aborted = false;
  private abortController: AbortController | null = null;

  async execute(
    input: ExecutorInput,
    onStdout?: (chunk: string) => void,
  ): Promise<ExecutorResult> {
    const providerKey = getProviderKey(input.model);
    const cfg = getProviderApiConfig(providerKey);

    if (!cfg.apiKey) {
      throw new Error(`No API key configured for provider: ${providerKey}`);
    }

    const startTime = Date.now();
    this.aborted = false;
    this.abortController = new AbortController();

    const modelId = getModelCliFlag(input.model) ?? input.model;

    try {
      if (providerKey === 'claude') {
        return await this.executeClaude(input, modelId, cfg.apiKey, startTime, onStdout);
      }
      if (providerKey === 'codex') {
        return await this.executeOpenAI(input, modelId, cfg.apiKey, startTime, onStdout);
      }
      if (providerKey === 'gemini') {
        return await this.executeGemini(input, modelId, cfg.apiKey, startTime, onStdout);
      }
      throw new Error(`API execution not supported for provider: ${providerKey}`);
    } catch (err) {
      const durationMs = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);
      if (this.aborted) {
        return {
          output: '',
          exitCode: -1,
          tokens: 0,
          durationMs,
          stderr: 'ABORTED: API call cancelled by user',
          artifacts: [],
        };
      }
      return {
        output: '',
        exitCode: 1,
        tokens: 0,
        durationMs,
        stderr: `API_ERROR: ${message}`,
        artifacts: [],
      };
    } finally {
      this.abortController = null;
    }
  }

  private async executeClaude(
    input: ExecutorInput,
    modelId: string,
    apiKey: string,
    startTime: number,
    onStdout?: (chunk: string) => void,
  ): Promise<ExecutorResult> {
    const client = new Anthropic({ apiKey });
    const stream = await client.messages.stream(
      {
        model: modelId,
        max_tokens: input.maxTokens ?? 4096,
        system: input.systemPrompt,
        messages: [{ role: 'user', content: input.prompt }],
      },
      { signal: this.abortController?.signal },
    );

    let output = '';
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        output += event.delta.text;
        onStdout?.(event.delta.text);
      }
    }
    const final = await stream.finalMessage();
    const tokens = (final.usage?.input_tokens ?? 0) + (final.usage?.output_tokens ?? 0);

    return {
      output,
      exitCode: 0,
      tokens,
      durationMs: Date.now() - startTime,
      stderr: '',
      artifacts: [],
    };
  }

  private async executeOpenAI(
    input: ExecutorInput,
    modelId: string,
    apiKey: string,
    startTime: number,
    onStdout?: (chunk: string) => void,
  ): Promise<ExecutorResult> {
    const client = new OpenAI({ apiKey });
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (input.systemPrompt) {
      messages.push({ role: 'system', content: input.systemPrompt });
    }
    messages.push({ role: 'user', content: input.prompt });

    const stream = await client.chat.completions.create(
      {
        model: modelId,
        messages,
        max_tokens: input.maxTokens,
        stream: true,
        stream_options: { include_usage: true },
      },
      { signal: this.abortController?.signal },
    );

    let output = '';
    let tokens = 0;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        output += delta;
        onStdout?.(delta);
      }
      if (chunk.usage) {
        tokens = (chunk.usage.prompt_tokens ?? 0) + (chunk.usage.completion_tokens ?? 0);
      }
    }

    return {
      output,
      exitCode: 0,
      tokens,
      durationMs: Date.now() - startTime,
      stderr: '',
      artifacts: [],
    };
  }

  private async executeGemini(
    input: ExecutorInput,
    modelId: string,
    apiKey: string,
    startTime: number,
    onStdout?: (chunk: string) => void,
  ): Promise<ExecutorResult> {
    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: modelId,
      systemInstruction: input.systemPrompt,
    });

    const result = await model.generateContentStream({
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: input.maxTokens ? { maxOutputTokens: input.maxTokens } : undefined,
    });

    let output = '';
    for await (const chunk of result.stream) {
      if (this.aborted) break;
      const text = chunk.text();
      if (text) {
        output += text;
        onStdout?.(text);
      }
    }

    const final = await result.response;
    const usage = final.usageMetadata;
    const tokens = (usage?.promptTokenCount ?? 0) + (usage?.candidatesTokenCount ?? 0);

    return {
      output,
      exitCode: 0,
      tokens,
      durationMs: Date.now() - startTime,
      stderr: '',
      artifacts: [],
    };
  }

  abort(): void {
    this.aborted = true;
    this.abortController?.abort();
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}
