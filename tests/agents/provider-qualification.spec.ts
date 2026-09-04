/* eslint-disable */
import { EventEmitter } from 'events';
import { AntigravityPythonBridge } from '@co/agents';
vi.mock('child_process', () => {
    const { EventEmitter } = require('events');
    return {
      spawn: vi.fn(() => {
        const mockChildProcess = Object.assign(new EventEmitter(), {
          stdin: { write: vi.fn(), end: vi.fn() },
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          kill: vi.fn(),
        });
        (global as any).__mockChildProcess = mockChildProcess;
        return mockChildProcess;
      })
    };
  });

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AgentRuntimeContext, WorkPackage, ToolGateway } from '@co/contracts';
import { CodexAdapter, AnthropicAdapter, GeminiAdapter, AntigravityAdapter } from '@co/agents';

const ctx: AgentRuntimeContext = {
  correlationId: randomUUID(),
  workflowRunId: randomUUID(),
  attemptId: randomUUID(),
  secretRefs: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY'],
};
const wp: WorkPackage = {
  schemaVersion: '1.0.0',
  workPackageId: 'wp',
  version: 1,
  projectId: 'p1',
  workItemId: 'w1',
  completionObjectRef: 'c1',
  objective: 'Test',
  authoritativeInputs: [],
  scope: { refs: [] },
  constraints: [],
  authorityContextRef: 'a1',
  requiredCapabilities: [],
  allowedActions: [],
  forbiddenActions: [],
  toolsAllowed: [],
  expectedArtifactsOut: [],
  verificationRequirements: [],
  evidenceRequirements: [],
  dependencies: [],
  stopConditions: [],
};

const providers = [
  {
    name: 'CodexAdapter (OpenAI)',
    factory: (mockClient: unknown) => new CodexAdapter({ execute: vi.fn() } as unknown as ToolGateway, 'codex', () => mockClient),
    mockClient: (opts?: Record<string, unknown>) => ({
      chat: {
        completions: {
          create: opts?.createFn ?? vi.fn().mockResolvedValue({
            id: 'mock-id',
            model: 'gpt-4o',
            choices: [{ message: { content: opts?.content ?? `\n\`\`\`json\n{"summary":"test","toolProposals":[],"artifacts":[]}\n\`\`\`\n` } }],
            usage: { prompt_tokens: 10, completion_tokens: 20 },
          }),
        },
      },
    }),
  },
  {
    name: 'AnthropicAdapter (Claude)',
    factory: (mockClient: unknown) => new AnthropicAdapter({ execute: vi.fn() } as unknown as ToolGateway, 'anthropic', () => mockClient),
    mockClient: (opts?: Record<string, unknown>) => ({
      messages: {
        create: opts?.createFn ?? vi.fn().mockResolvedValue({
          id: 'mock-id',
          model: 'claude-3-5-sonnet',
          content: [{ text: opts?.content ?? `\n\`\`\`json\n{"summary":"test","toolProposals":[],"artifacts":[]}\n\`\`\`\n` }],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      },
    }),
  },
  {
    name: 'GeminiAdapter (Google)',
    factory: (mockClient: unknown) => new GeminiAdapter({ execute: vi.fn() } as unknown as ToolGateway, 'gemini', () => mockClient),
    mockClient: (opts?: Record<string, unknown>) => ({
      getGenerativeModel: () => ({
        generateContent: opts?.createFn ?? vi.fn().mockResolvedValue({
          response: {
            text: () => opts?.content ?? `\n\`\`\`json\n{"summary":"test","toolProposals":[],"artifacts":[]}\n\`\`\`\n`,
            usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20 },
          },
        }),
      }),
    }),
  },
  {
    name: 'AntigravityAdapter',
    factory: (mockClient: unknown) => new AntigravityAdapter(mockClient as any),
    mockClient: (opts?: Record<string, unknown>) => {
      const bridge = new AntigravityPythonBridge(() => ({} as any), { redact: (s) => s } as any);
      (bridge as any)._opts = opts;
      return bridge;
    }
  }
];

describe('Provider Qualification (Multi-Provider)', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';
    process.env.GEMINI_API_KEY = 'test-key';
  });

  for (const provider of providers) {
    describe(provider.name, () => {
      it('capabilities: reports correctly', async () => {
        const adapter = provider.factory(provider.mockClient());
        const caps = await adapter.capabilities();
        expect(caps.capabilities.code_generation).toBe('SUPPORTED');
        expect(caps.capabilities.resumable_session).toBe('NOT_SUPPORTED');
      });
      
      it('health: returns AVAILABLE when keys exist', async () => {
        const adapter = provider.factory(provider.mockClient());
        const h = await adapter.health();
        expect(h).toBe('AVAILABLE');
      });

      it('usage & cost accounting: records tokens and parses cost', async () => {
          if (provider.name === 'AntigravityAdapter') {
            const bridge = provider.mockClient() as any;
            const adapter = provider.factory(bridge);
            const handle = await adapter.execute(wp, ctx);
            const mockChildProcess = (global as any).__mockChildProcess;
            mockChildProcess.stdout.emit('data', Buffer.from(JSON.stringify({
              schemaVersion: '1.0.0', runRef: { runId: handle.runId }, status: 'COMPLETED',
              summary: 'Done', actionsTaken: [], artifacts: [], findings: [], evidence: [],
              unresolvedItems: [], requestedInputs: [], sideEffects: [], usage: { inputUnits: 10, outputUnits: 20, estimatedCost: 0, currency: 'USD', costStatus: 'UNKNOWN' }
            })));
            mockChildProcess.emit('close', 0);
            await new Promise(r => setTimeout(r, 50));
            const usage = await adapter.getUsage(handle);
            expect(usage.inputUnits).toBe(10);
            expect(usage.outputUnits).toBe(20);
            return;
          }
        const adapter = provider.factory(provider.mockClient());
        const handle = await adapter.execute(wp, ctx);
        await new Promise((r) => setTimeout(r, 500));
        
        const usage = await adapter.getUsage(handle);
        expect(usage.inputUnits).toBe(10);
        expect(usage.outputUnits).toBe(20);
      });
      
      it('genuine resume: throws UNSUPPORTED', async () => {
        const adapter = provider.factory(provider.mockClient());
        await expect(adapter.resume({ runRef: { runId: 'r1' }, runtimeContext: ctx })).rejects.toThrow('UNSUPPORTED');
      });

      // if
        it('timeout: aborts and returns FAILED', async () => {
          if (provider.name === 'AntigravityAdapter') {
            vi.useFakeTimers();
            const bridge = provider.mockClient() as any;
            const adapter = provider.factory(bridge);
            const handle = await adapter.execute(wp, { ...ctx, timeBudgetMs: 10 });
            const mockChildProcess = (global as any).__mockChildProcess;
            await vi.advanceTimersByTimeAsync(20);
            mockChildProcess.emit('close', 0);
            const status = await adapter.getStatus(handle);
            expect(status).toBe('FAILED');
            const ev = await adapter.getEvidence(handle);
            expect(ev.some(e => e.claimSupported === 'Timeout')).toBe(true);
            vi.useRealTimers();
            return;
          }
          const mockCreate = vi.fn().mockImplementation(async (opts: Record<string, unknown>, reqOpts: Record<string, unknown>) => {
            return new Promise((resolve, reject) => {
              const signal = reqOpts?.signal || opts?.signal;
              if (signal) {
                signal.addEventListener('abort', () => reject(new Error('Timeout')));
              }
            });
          });
          
          const adapter = provider.factory(provider.mockClient({ createFn: mockCreate }));
          const handle = await adapter.execute(wp, { ...ctx, timeBudgetMs: 10 });
          
          await new Promise((r) => setTimeout(r, 500));
          const status = await adapter.getStatus(handle);
          expect(status).toBe('FAILED');
          
          const ev = await adapter.getEvidence(handle);
          expect(ev.some(e => e.type === 'error' && e.claimSupported === 'Timeout')).toBe(true);
        });

        it('cancellation: natively aborts and returns CANCELLED', async () => {
          if (provider.name === 'AntigravityAdapter') {
            const bridge = provider.mockClient() as any;
            const adapter = provider.factory(bridge);
            const handle = await adapter.execute(wp, ctx);
            const mockChildProcess = (global as any).__mockChildProcess;
            await adapter.cancel({ runRef: handle, reason: 'User cancelled' });
            mockChildProcess.emit('close', 0);
            await new Promise(r => setTimeout(r, 50));
            const status = await adapter.getStatus(handle);
            expect(status).toBe('CANCELLED');
            return;
          }
          const mockCreate = vi.fn().mockImplementation(async (opts: Record<string, unknown>, reqOpts: Record<string, unknown>) => {
            return new Promise((resolve, reject) => {
              const signal = reqOpts?.signal || opts?.signal;
              if (signal) {
                signal.addEventListener('abort', () => reject(new Error('User cancelled')));
              }
            });
          });
          
          const adapter = provider.factory(provider.mockClient({ createFn: mockCreate }));
          const handle = await adapter.execute(wp, ctx);
          
          await adapter.cancel({ runRef: handle, reason: 'User cancelled' });
          await new Promise((r) => setTimeout(r, 500));
          
          const status = await adapter.getStatus(handle);
          expect(status).toBe('CANCELLED');
        });

        it('provider outage (500): returns FAILED after retries', async () => {
          if (provider.name === 'AntigravityAdapter') {
            const bridge = provider.mockClient() as any;
            const adapter = provider.factory(bridge);
            const handle = await adapter.execute(wp, ctx);
            const mockChildProcess = (global as any).__mockChildProcess;
            mockChildProcess.emit('error', new Error('Spawn failed'));
            await new Promise((r) => setTimeout(r, 50));
            const status = await adapter.getStatus(handle);
            expect(status).toBe('FAILED');
            return;
          }
          const mockCreate = vi.fn().mockRejectedValue({ status: 500 });
          const adapter = provider.factory(provider.mockClient({ createFn: mockCreate }));
          const handle = await adapter.execute(wp, ctx);
          
          await new Promise((r) => setTimeout(r, 2000)); // wait for 3 retries
          const status = await adapter.getStatus(handle);
          expect(status).toBe('FAILED');
          
          const ev = await adapter.getEvidence(handle);
          if (!ev.some(e => e.type === "retry")) throw new Error("EVIDENCE: " + JSON.stringify(ev));
        });

        it('rate limiting (429): returns INTERRUPTED after retries', async () => {
          if (provider.name === 'AntigravityAdapter') {
            const adapter = provider.factory(provider.mockClient());
            const caps = await adapter.capabilities();
            expect(caps.capabilities.rate_limit_handling).toBe('NOT_SUPPORTED');
            return;
          }
          const mockCreate = vi.fn().mockRejectedValue({ status: 429 });
          const adapter = provider.factory(provider.mockClient({ createFn: mockCreate }));
          const handle = await adapter.execute(wp, ctx);
          
          await new Promise((r) => setTimeout(r, 2000));
          const status = await adapter.getStatus(handle);
          expect(status).toBe('INTERRUPTED');
          
          const ev = await adapter.getEvidence(handle);
          if (!ev.some(e => e.type === "retry")) throw new Error("EVIDENCE: " + JSON.stringify(ev));
        });
        
        it('malformed output: returns FAILED with evidence', async () => {
          if (provider.name === 'AntigravityAdapter') {
             const bridge = provider.mockClient() as any;
             const adapter = provider.factory(bridge);
             const handle = await adapter.execute(wp, ctx);
             const mockChildProcess = (global as any).__mockChildProcess;
             mockChildProcess.stdout.emit('data', Buffer.from('{"invalid": true'));
             mockChildProcess.emit('close', 0);
             await new Promise(r => setTimeout(r, 50));
             const status = await adapter.getStatus(handle);
             expect(status).toBe('FAILED');
             return;
          }
           const adapter = provider.factory(provider.mockClient({ content: '{"invalid": true' }));
           const handle = await adapter.execute(wp, ctx);
           
           await new Promise((r) => setTimeout(r, 500));
           const status = await adapter.getStatus(handle);
           expect(status).toBe('FAILED');
           
           const ev = await adapter.getEvidence(handle);
           expect(ev.some(e => e.type === 'malformed_output')).toBe(true);
        });
    });
  }
});
