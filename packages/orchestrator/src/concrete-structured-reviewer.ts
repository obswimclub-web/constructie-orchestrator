import type { AgentRunResult } from '@co/contracts';
import type { StructuredReviewer, ReviewDecision } from '@co/workflow';
import type { ExecutionGate, OwnerAuthorityToken } from '@co/policy';

export interface ConcreteReviewDecision {
  decision: ReviewDecision;
  feedback?: string;
  nextAction?: string;
  pendingAction?: string;
  pendingGate?: ExecutionGate;
  pendingAuthorityType?: OwnerAuthorityToken;
}

export class ConcreteStructuredReviewer implements StructuredReviewer {
  /**
   * Reviews a completed agent run result and returns a structured decision.
   *
   * Decision routing:
   * - FAILED                   → FAIL_REPAIRABLE (with feedback from summary)
   * - CANCELLED / INTERRUPTED  → AMBIGUOUS_SIDE_EFFECT (unknown if action committed)
   * - requestedInputs present  → OWNER_DECISION_REQUIRED with exact gate/action/authority bindings
   * - COMPLETED, no inputs     → COMPLETE (run fully done, no continuation required)
   *
   * PASS is never emitted without a concrete nextAction — the coordinator enforces this.
   */
  public async reviewExecution(result: AgentRunResult): Promise<ConcreteReviewDecision> {
    if (result.status === 'FAILED') {
      return { decision: 'FAIL_REPAIRABLE', feedback: result.summary };
    }

    if (result.status === 'CANCELLED' || result.status === 'INTERRUPTED') {
      return {
        decision: 'AMBIGUOUS_SIDE_EFFECT',
        feedback: `Run ${result.status.toLowerCase()} — side-effect state unknown`,
      };
    }

    // If the agent requested owner inputs, pause for structured Owner authority
    if (result.requestedInputs && result.requestedInputs.length > 0) {
      return {
        decision: 'OWNER_DECISION_REQUIRED',
        pendingAction: 'provide_input',
        pendingGate: 'OWNER_PRECOMMIT',
        pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED',
        feedback: `Agent requested ${result.requestedInputs.length} input(s)`,
      };
    }

    // COMPLETED with no inputs and no continuation plan → COMPLETE, close the run
    return { decision: 'COMPLETE', feedback: result.summary };
  }
}
