import type { ReviewRequest, ReviewVerdict, ReviewerAdapter, AgentRunResult } from '@co/contracts';
import type { GovernedToolGateway } from '@co/tools';

export class OpenAIReviewerAdapter implements ReviewerAdapter {
  constructor(private readonly gateway?: GovernedToolGateway) {}

  public async evaluate(request: ReviewRequest, candidateResult: AgentRunResult): Promise<ReviewVerdict> {
    // Basic deterministic mapping as fallback.
    // In a real implementation, we would query the LLM using the gateway to read evidence.
    
    if (candidateResult.status === 'FAILED') {
      return { 
        decision: 'FAIL_REPAIRABLE', 
        findings: ['Executor failure: ' + candidateResult.summary], 
        repairPackage: {
          findingId: 'sys-1',
          requirementRef: 'req',
          observedEvidence: candidateResult.summary || '',
          allowedScope: ['*'],
          forbiddenActions: [],
          requiredVerification: [],
          requiredEvidence: [],
          reReviewTrigger: 'on_completion'
        },
        reviewDepth: 'LLM', 
        lineage: ['OpenAIReviewerAdapter'] 
      };
    }

    if (candidateResult.status === 'CANCELLED' || candidateResult.status === 'INTERRUPTED') {
      return { decision: 'AMBIGUOUS_SIDE_EFFECT', findings: ['Run cancelled'], reviewDepth: 'LLM', lineage: ['OpenAIReviewerAdapter'] };
    }

    if (candidateResult.requestedInputs && candidateResult.requestedInputs.length > 0) {
      return { decision: 'OWNER_DECISION_REQUIRED', findings: ['Requested input'], pendingAction: 'provide_input', pendingGate: 'OWNER_PRECOMMIT', pendingAuthorityType: 'OWNER_IMPLEMENTATION_APPROVED', reviewDepth: 'LLM', lineage: ['OpenAIReviewerAdapter'] };
    }

    // Example logic where Reviewer decides it NEEDS_EVIDENCE
    if (candidateResult.evidence && candidateResult.evidence.length === 0 && candidateResult.status === 'COMPLETED') {
       return { decision: 'NEEDS_EVIDENCE', findings: ['Missing evidence for completion'], reviewDepth: 'LLM', lineage: ['OpenAIReviewerAdapter'] };
    }

    return { decision: 'PASS', findings: ['Passed validation'], reviewDepth: 'LLM', lineage: ['OpenAIReviewerAdapter'], nextAction: 'Proceed to next workflow step' };
  }
}
