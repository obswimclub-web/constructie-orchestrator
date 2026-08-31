import { describe, expect, it } from 'vitest';
import { OpenAIReviewerAdapter } from '../../packages/agents/src/reviewer/openai-reviewer-adapter.js';
import type { ReviewRequest, AgentRunResult } from '@co/contracts';

describe('OpenAIReviewerAdapter Canonical', () => {
  it('maps FAILED to FAIL', async () => {
    const reviewer = new OpenAIReviewerAdapter();
    const result = await reviewer.evaluate(
       {} as unknown as ReviewRequest, 
       { status: 'FAILED', summary: 'err' } as unknown as AgentRunResult
    );
    expect(result.decision).toBe('FAIL_REPAIRABLE');
  });

  it('maps requestedInputs to OWNER_REQUIRED', async () => {
    const reviewer = new OpenAIReviewerAdapter();
    const result = await reviewer.evaluate(
       {} as unknown as ReviewRequest, 
       { status: 'COMPLETED', summary: 'need input', requestedInputs: [{}] } as unknown as AgentRunResult
    );
    expect(result.decision).toBe('OWNER_DECISION_REQUIRED');
    expect(result.pendingGate).toBe('OWNER_PRECOMMIT');
  });

  it('maps COMPLETED without inputs to COMPLETE (terminal)', async () => {
    const reviewer = new OpenAIReviewerAdapter();
    const result = await reviewer.evaluate(
       {} as unknown as ReviewRequest, 
       { status: 'COMPLETED', summary: 'done', requestedInputs: [] } as unknown as AgentRunResult
    );
    expect(result.decision).toBe('COMPLETE');
  });
});
