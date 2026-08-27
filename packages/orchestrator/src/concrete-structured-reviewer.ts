import type { AgentRunResult } from '@co/contracts';
import type { StructuredReviewer, ReviewDecision } from '@co/workflow';

export class ConcreteStructuredReviewer implements StructuredReviewer {
  public async reviewExecution(result: AgentRunResult): Promise<{ decision: ReviewDecision; feedback?: string; pendingAction?: string }> {
    if (result.status === 'FAILED') {
      return { decision: 'FAIL_REPAIRABLE', feedback: result.summary };
    }
    if (result.status === 'CANCELLED' || result.status === 'INTERRUPTED') {
      return { decision: 'AMBIGUOUS_SIDE_EFFECT', feedback: 'Run interrupted' };
    }
    
    // Concrete logic: if there are requested inputs, require owner decision
    if (result.requestedInputs && result.requestedInputs.length > 0) {
      return { decision: 'OWNER_DECISION_REQUIRED', pendingAction: 'provide_input', feedback: 'Inputs requested by agent' };
    }
    
    // Fallback pass
    return { decision: 'PASS' };
  }
}
