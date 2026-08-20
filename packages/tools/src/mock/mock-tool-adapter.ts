import { randomUUID } from 'node:crypto';
import {
  TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
  type AuthorizedToolRequest,
  type ToolAdapter,
  type ToolExecutionResult,
} from '@co/contracts';

export type MockToolScenario = 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'UNKNOWN';

export class MockToolAdapter implements ToolAdapter {
  public readonly toolId = 'mock';
  public constructor(private readonly scenario: MockToolScenario = 'SUCCESS') {}

  public async executeAuthorized(input: AuthorizedToolRequest): Promise<ToolExecutionResult> {
    const base = {
      schemaVersion: TOOL_EXECUTION_RESULT_SCHEMA_VERSION,
      executionId: randomUUID(),
      requestId: input.request.requestId,
      toolId: this.toolId,
      operationId: input.request.operationId,
      artifacts: [],
      evidenceCandidates: [],
      sideEffects: [],
    } as const;

    switch (this.scenario) {
      case 'SUCCESS':
        return { ...base, status: 'SUCCEEDED', summary: 'Mock tool execution succeeded', reconciliationRequired: false };
      case 'FAIL':
        return { ...base, status: 'FAILED', summary: 'Mock tool execution failed', reconciliationRequired: false };
      case 'TIMEOUT':
        return { ...base, status: 'TIMED_OUT', summary: 'Mock tool execution timed out', reconciliationRequired: true };
      case 'UNKNOWN':
        return { ...base, status: 'UNKNOWN', summary: 'Mock tool effect is unknown', reconciliationRequired: true };
    }
  }
}
