import { describe, expect, it, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { AgentRuntimeContext, WorkPackage, ToolGateway } from '@co/contracts';
import { CodexAdapter } from '@co/agents';

const ctx: AgentRuntimeContext = {
  correlationId: randomUUID(),
  workflowRunId: randomUUID(),
  attemptId: randomUUID(),
  secretRefs: ['OPENAI_API_KEY'],
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

describe('CodexAdapter', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('maps HTTP 429 to INTERRUPTED', async () => {
    // Must reject all 3 retry attempts to exhaust retries
    const mockCreate = vi.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 });
    const factory = () => ({
      chat: { completions: { create: mockCreate } },
    });
    const mockGateway = { execute: vi.fn() } as unknown as ToolGateway;
    const adapter = new CodexAdapter(mockGateway, 'codex-adapter', factory);
    const handle = await adapter.execute(wp, ctx);

    // Wait for all 3 retries (100ms delay between each) + settling
    await new Promise((resolve) => setTimeout(resolve, 500));

    const status = await adapter.getStatus(handle);
    expect(status).toBe('INTERRUPTED');
  });

  it('maps HTTP 401 to FAILED (CRITICAL)', async () => {
    const mockCreate = vi.fn().mockRejectedValueOnce({ status: 401 });
    const factory = () => ({
      chat: { completions: { create: mockCreate } },
    });
    const mockGateway = { execute: vi.fn() } as unknown as ToolGateway;
    const adapter = new CodexAdapter(mockGateway, 'codex-adapter', factory);
    const handle = await adapter.execute(wp, ctx);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const status = await adapter.getStatus(handle);
    expect(status).toBe('FAILED');
  });

  it('maps HTTP 500 to FAILED (HIGH)', async () => {
    // Must reject all 3 retry attempts to exhaust retries
    const mockCreate = vi.fn()
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 500 })
      .mockRejectedValueOnce({ status: 500 });
    const factory = () => ({
      chat: { completions: { create: mockCreate } },
    });
    const mockGateway = { execute: vi.fn() } as unknown as ToolGateway;
    const adapter = new CodexAdapter(mockGateway, 'codex-adapter', factory);
    const handle = await adapter.execute(wp, ctx);

    // Wait for all 3 retries (100ms delay between each) + settling
    await new Promise((resolve) => setTimeout(resolve, 500));

    const status = await adapter.getStatus(handle);
    expect(status).toBe('FAILED');
  });

  it('resolves OPENAI_API_KEY, generates runId and idempotencyKey', async () => {
    const mockCreate = vi.fn().mockResolvedValueOnce({
      id: 'mock-id',
      model: 'gpt-4o',
      choices: [{ message: { content: 'test output' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    });
    let capturedKey = '';
    const factory = (key: string) => {
      capturedKey = key;
      return { chat: { completions: { create: mockCreate } } };
    };
    const mockGateway = { execute: vi.fn() } as unknown as ToolGateway;
    const adapter = new CodexAdapter(mockGateway, 'codex-adapter', factory);

    const handle = await adapter.execute(wp, ctx);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(capturedKey).toBe('test-key');
    // Now passes signal in addition to idempotencyKey
    expect(mockCreate).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      idempotencyKey: `${ctx.attemptId}-${handle.runId}`,
    }));

    const status = await adapter.getStatus(handle);
    expect(status).toBe('COMPLETED');

    const artifacts = await adapter.getArtifacts(handle);
    // Content is detected as malformed (starts with lowercase, no code block) so FAILED
    // Actually 'test output' doesn't start with { so it's not detected as malformed
    expect(artifacts.length).toBeGreaterThan(0);
  });
});
