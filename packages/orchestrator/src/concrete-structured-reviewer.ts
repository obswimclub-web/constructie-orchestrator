import type { AgentRunResult, ReviewVerdict, ReviewRequest, ReviewerAdapter } from '@co/contracts';
import type { StructuredReviewer } from '@co/workflow';
import type { ExecutionGate, OwnerAuthorityToken } from '@co/policy';

export class ConcreteStructuredReviewer implements StructuredReviewer {
  constructor(private readonly adapter?: ReviewerAdapter) {}

  public async reviewExecution(result: AgentRunResult, request?: ReviewRequest): Promise<ReviewVerdict> {
    if (result.status === 'FAILED') {
      return { decision: 'FAIL_REPAIRABLE', findings: [result.summary || 'Failed'], lineage: ['ConcreteStructuredReviewer'], reviewDepth: 'SYSTEM' };
    }

    if (result.status === 'CANCELLED' || result.status === 'INTERRUPTED') {
      return {
        decision: 'AMBIGUOUS_SIDE_EFFECT',
        findings: [`Run ${result.status.toLowerCase()} — side-effect state unknown`],
        lineage: ['ConcreteStructuredReviewer'], reviewDepth: 'SYSTEM'
      };
    }

    // If the agent requested owner inputs, pause for structured Owner authority
    if (result.requestedInputs && result.requestedInputs.length > 0) {
      return {
        decision: 'OWNER_DECISION_REQUIRED',
        pendingAction: 'provide_input',
        pendingGate: 'OWNER_PRECOMMIT',
        pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED',
        findings: [`Agent requested ${result.requestedInputs.length} input(s)`],
        lineage: ['ConcreteStructuredReviewer'], reviewDepth: 'SYSTEM'
      };
    }

    if (this.adapter && request) {
      return await this.adapter.evaluate(request, result);
    }

    // COMPLETED with no inputs and no continuation plan -> COMPLETE, close the run
    return { decision: 'COMPLETE', findings: [result.summary || 'Completed'], lineage: ['ConcreteStructuredReviewer'], reviewDepth: 'SYSTEM' };
  }
}
