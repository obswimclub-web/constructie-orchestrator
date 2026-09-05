import { PrismaClient } from '@prisma/client';
import type { TraceResult } from '@co/observability';

export class PrismaTraceabilityService {
  constructor(private readonly prisma: PrismaClient) {}

  private async traceFromEvidenceIds(projectId: string, evidenceIds: string[], inputWorkItemId?: string, inputApprovalId?: string, inputAgentId?: string, inputAttemptId?: string): Promise<TraceResult> {
    const attempts = new Set<string>();
    const workItems = new Set<string>();
    const approvals = new Set<string>();
    const agents = new Set<string>();
    const evidenceSet = new Set<string>(evidenceIds);
    const verificationIds = new Set<string>();
    const completions = new Set<string>();

    if (inputWorkItemId) workItems.add(inputWorkItemId);
    if (inputApprovalId) approvals.add(inputApprovalId);
    if (inputAgentId) agents.add(inputAgentId);
    if (inputAttemptId) attempts.add(inputAttemptId);

    // Find verifications that reference any of these evidence IDs
    // Since evidenceIds is a JSON array in DB, this is slightly tricky to query efficiently in Postgres without raw query or we just fetch verifications for the project.
    // For now we'll do raw or fetch relevant. If we are tracing by commit/deployment, we know the projectId.
    // To be perfectly robust for P9 and project isolated, we'll use a raw query or just fetch verifications for the project and filter if the project is small.
    // To use index: The prompt asks to "Add appropriate DB indexes for commonly queried reverse-traceability fields."
    
    // We can fetch all verifications for the project (bounded) or do a raw query.
    const verifications = await this.prisma.verificationRecord.findMany({
      where: { projectId }
    });

    for (const ver of verifications) {
      const eIds = ver.evidenceIds as string[];
      if (Array.isArray(eIds) && eIds.some(eid => evidenceSet.has(eid))) {
        verificationIds.add(ver.id);
        if (ver.completionDecisionId) completions.add(ver.completionDecisionId);
        if (ver.attemptId) attempts.add(ver.attemptId);
        if (ver.workItemId) workItems.add(ver.workItemId);
      }
    }

    return {
      projectId,
      workItemIds: Array.from(workItems).sort(),
      approvalIds: Array.from(approvals).sort(),
      agentIds: Array.from(agents).sort(),
      attemptIds: Array.from(attempts).sort(),
      evidenceIds: Array.from(evidenceSet).sort(),
      verificationIds: Array.from(verificationIds).sort(),
      completionDecisionIds: Array.from(completions).sort(),
    };
  }

  public async traceScmCommit(projectId: string, commitSha: string): Promise<TraceResult> {
    const evidence = await this.prisma.evidenceRecord.findMany({
      where: { projectId, scmCommitSha: commitSha }
    });
    
    const eIds = evidence.map(e => e.id);
    const result = await this.traceFromEvidenceIds(projectId, eIds);
    
    for (const ev of evidence) {
      if (ev.attemptId) result.attemptIds.push(ev.attemptId);
      if (ev.workItemId) result.workItemIds.push(ev.workItemId);
      if (ev.approvalId) result.approvalIds.push(ev.approvalId);
      if (ev.agentId) result.agentIds.push(ev.agentId);
    }
    
    // Deduplicate
    result.attemptIds = Array.from(new Set(result.attemptIds)).sort();
    result.workItemIds = Array.from(new Set(result.workItemIds)).sort();
    result.approvalIds = Array.from(new Set(result.approvalIds)).sort();
    result.agentIds = Array.from(new Set(result.agentIds)).sort();
    
    return { ...result, commitSha };
  }

  public async traceDeployment(projectId: string, deploymentUri: string): Promise<TraceResult> {
    const evidence = await this.prisma.evidenceRecord.findMany({
      where: { projectId, deploymentUri }
    });
    
    const eIds = evidence.map(e => e.id);
    const result = await this.traceFromEvidenceIds(projectId, eIds);
    
    for (const ev of evidence) {
      if (ev.attemptId) result.attemptIds.push(ev.attemptId);
      if (ev.workItemId) result.workItemIds.push(ev.workItemId);
      if (ev.approvalId) result.approvalIds.push(ev.approvalId);
      if (ev.agentId) result.agentIds.push(ev.agentId);
    }
    
    result.attemptIds = Array.from(new Set(result.attemptIds)).sort();
    result.workItemIds = Array.from(new Set(result.workItemIds)).sort();
    result.approvalIds = Array.from(new Set(result.approvalIds)).sort();
    result.agentIds = Array.from(new Set(result.agentIds)).sort();
    
    return { ...result, deploymentUri };
  }
  
  public async traceArtifact(projectId: string, artifactId: string): Promise<TraceResult> {
    const evidence = await this.prisma.evidenceRecord.findMany({
      where: { projectId, artifactId }
    });
    
    const eIds = evidence.map(e => e.id);
    const result = await this.traceFromEvidenceIds(projectId, eIds);
    
    for (const ev of evidence) {
      if (ev.attemptId) result.attemptIds.push(ev.attemptId);
      if (ev.workItemId) result.workItemIds.push(ev.workItemId);
      if (ev.approvalId) result.approvalIds.push(ev.approvalId);
      if (ev.agentId) result.agentIds.push(ev.agentId);
    }
    
    result.attemptIds = Array.from(new Set(result.attemptIds)).sort();
    result.workItemIds = Array.from(new Set(result.workItemIds)).sort();
    result.approvalIds = Array.from(new Set(result.approvalIds)).sort();
    result.agentIds = Array.from(new Set(result.agentIds)).sort();
    
    return { ...result, artifactId };
  }
  
  public async traceEvidence(projectId: string, evidenceId: string): Promise<TraceResult> {
    const evidence = await this.prisma.evidenceRecord.findUnique({
      where: { id: evidenceId }
    });
    
    if (!evidence || evidence.projectId !== projectId) {
      return this.traceFromEvidenceIds(projectId, []);
    }
    
    const result = await this.traceFromEvidenceIds(projectId, [evidenceId]);
    if (evidence.attemptId) result.attemptIds.push(evidence.attemptId);
    if (evidence.workItemId) result.workItemIds.push(evidence.workItemId);
    if (evidence.approvalId) result.approvalIds.push(evidence.approvalId);
    if (evidence.agentId) result.agentIds.push(evidence.agentId);
    
    result.attemptIds = Array.from(new Set(result.attemptIds)).sort();
    result.workItemIds = Array.from(new Set(result.workItemIds)).sort();
    result.approvalIds = Array.from(new Set(result.approvalIds)).sort();
    result.agentIds = Array.from(new Set(result.agentIds)).sort();
    
    return result;
  }
  
  public async traceVerification(projectId: string, verificationId: string): Promise<TraceResult> {
    const ver = await this.prisma.verificationRecord.findUnique({
      where: { id: verificationId }
    });
    
    if (!ver || ver.projectId !== projectId) {
      return this.traceFromEvidenceIds(projectId, []);
    }
    
    const eIds = (ver.evidenceIds as string[]) || [];
    const result = await this.traceFromEvidenceIds(projectId, eIds, ver.workItemId, undefined, undefined, ver.attemptId ?? undefined);
    
    if (ver.completionDecisionId) result.completionDecisionIds.push(ver.completionDecisionId);
    
    result.completionDecisionIds = Array.from(new Set(result.completionDecisionIds)).sort();
    
    return result;
  }
}
