import type { ExecutionLogRecord } from './logs.js';
import type { IncidentEventRecord } from './incidents.js';
import type { EvidenceRecord, VerificationRecord } from '@co/evidence';

export interface TimelineEvent {
  timestamp: Date;
  id: string;
  type: 'LOG' | 'INCIDENT_EVENT';
  data: ExecutionLogRecord | IncidentEventRecord;
}

export class AttemptReconstructor {
  public static reconstructByAttempt(
    projectId: string,
    attemptId: string,
    logs: readonly ExecutionLogRecord[],
    incidents: readonly IncidentEventRecord[]
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];
    
    for (const log of logs) {
      if (log.projectId === projectId && log.attemptId === attemptId) {
        events.push({ timestamp: log.timestamp, id: log.id, type: 'LOG', data: log });
      }
    }
    
    for (const inc of incidents) {
      if (inc.projectId === projectId && inc.attemptId === attemptId) {
        events.push({ timestamp: inc.timestamp, id: inc.id, type: 'INCIDENT_EVENT', data: inc });
      }
    }
    
    return events.sort((a, b) => {
      const tDiff = a.timestamp.getTime() - b.timestamp.getTime();
      if (tDiff !== 0) return tDiff;
      return a.id.localeCompare(b.id);
    });
  }
}

export interface TraceResult {
  projectId: string;
  commitSha?: string;
  deploymentUri?: string;
  artifactId?: string;
  workItemIds: string[];
  approvalIds: string[];
  agentIds: string[];
  attemptIds: string[];
  evidenceIds: string[];
  verificationIds: string[];
  completionDecisionIds: string[];
}

export class TraceabilityEngine {
  public static traceScmCommit(
    projectId: string,
    commitSha: string,
    evidence: readonly EvidenceRecord[],
    verifications: readonly VerificationRecord[]
  ): TraceResult {
    const attempts = new Set<string>();
    const workItems = new Set<string>();
    const approvals = new Set<string>();
    const agents = new Set<string>();
    const evidenceIds = new Set<string>();
    const verificationIds = new Set<string>();
    const completions = new Set<string>();

    for (const ev of evidence) {
      if (ev.projectId === projectId && ev.scmCommitSha === commitSha) {
        evidenceIds.add(ev.id);
        if (ev.attemptId) attempts.add(ev.attemptId);
        if (ev.workItemId) workItems.add(ev.workItemId);
        if (ev.approvalId) approvals.add(ev.approvalId);
        if (ev.agentId) agents.add(ev.agentId);
      }
    }

    for (const ver of verifications) {
      if (ver.projectId === projectId && ver.evidenceIds.some(eid => evidenceIds.has(eid))) {
        verificationIds.add(ver.id);
        if (ver.completionDecisionId) completions.add(ver.completionDecisionId);
        if (ver.attemptId) attempts.add(ver.attemptId);
        if (ver.workItemId) workItems.add(ver.workItemId);
      }
    }

    return {
      projectId,
      commitSha,
      workItemIds: Array.from(workItems).sort(),
      approvalIds: Array.from(approvals).sort(),
      agentIds: Array.from(agents).sort(),
      attemptIds: Array.from(attempts).sort(),
      evidenceIds: Array.from(evidenceIds).sort(),
      verificationIds: Array.from(verificationIds).sort(),
      completionDecisionIds: Array.from(completions).sort(),
    };
  }

  public static traceArtifact(
    projectId: string,
    artifactId: string,
    evidence: readonly EvidenceRecord[],
    verifications: readonly VerificationRecord[]
  ): TraceResult {
    const attempts = new Set<string>();
    const workItems = new Set<string>();
    const approvals = new Set<string>();
    const agents = new Set<string>();
    const evidenceIds = new Set<string>();
    const verificationIds = new Set<string>();
    const completions = new Set<string>();

    for (const ev of evidence) {
      if (ev.projectId === projectId && ev.artifactId === artifactId) {
        evidenceIds.add(ev.id);
        if (ev.attemptId) attempts.add(ev.attemptId);
        if (ev.workItemId) workItems.add(ev.workItemId);
        if (ev.approvalId) approvals.add(ev.approvalId);
        if (ev.agentId) agents.add(ev.agentId);
      }
    }

    for (const ver of verifications) {
      if (ver.projectId === projectId && ver.evidenceIds.some(eid => evidenceIds.has(eid))) {
        verificationIds.add(ver.id);
        if (ver.completionDecisionId) completions.add(ver.completionDecisionId);
        if (ver.attemptId) attempts.add(ver.attemptId);
        if (ver.workItemId) workItems.add(ver.workItemId);
      }
    }

    return {
      projectId,
      artifactId,
      workItemIds: Array.from(workItems).sort(),
      approvalIds: Array.from(approvals).sort(),
      agentIds: Array.from(agents).sort(),
      attemptIds: Array.from(attempts).sort(),
      evidenceIds: Array.from(evidenceIds).sort(),
      verificationIds: Array.from(verificationIds).sort(),
      completionDecisionIds: Array.from(completions).sort(),
    };
  }

  public static traceDeployment(
    projectId: string,
    deploymentUri: string,
    evidence: readonly EvidenceRecord[],
    verifications: readonly VerificationRecord[]
  ): TraceResult {
    const attempts = new Set<string>();
    const workItems = new Set<string>();
    const approvals = new Set<string>();
    const agents = new Set<string>();
    const evidenceIds = new Set<string>();
    const verificationIds = new Set<string>();
    const completions = new Set<string>();

    for (const ev of evidence) {
      if (ev.projectId === projectId && ev.deploymentUri === deploymentUri) {
        evidenceIds.add(ev.id);
        if (ev.attemptId) attempts.add(ev.attemptId);
        if (ev.workItemId) workItems.add(ev.workItemId);
        if (ev.approvalId) approvals.add(ev.approvalId);
        if (ev.agentId) agents.add(ev.agentId);
      }
    }

    for (const ver of verifications) {
      if (ver.projectId === projectId && ver.evidenceIds.some(eid => evidenceIds.has(eid))) {
        verificationIds.add(ver.id);
        if (ver.completionDecisionId) completions.add(ver.completionDecisionId);
        if (ver.attemptId) attempts.add(ver.attemptId);
        if (ver.workItemId) workItems.add(ver.workItemId);
      }
    }

    return {
      projectId,
      deploymentUri,
      workItemIds: Array.from(workItems).sort(),
      approvalIds: Array.from(approvals).sort(),
      agentIds: Array.from(agents).sort(),
      attemptIds: Array.from(attempts).sort(),
      evidenceIds: Array.from(evidenceIds).sort(),
      verificationIds: Array.from(verificationIds).sort(),
      completionDecisionIds: Array.from(completions).sort(),
    };
  }
}

export const CAN_RECONSTRUCT_RUN_FROM_PERSISTED_OR_DURABLE_RECORDS = true;

export class RunReconstructor {
  public static reconstructByRun(
    projectId: string,
    runId: string,
    logs: readonly ExecutionLogRecord[],
    incidents: readonly IncidentEventRecord[]
  ): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    for (const log of logs) {
      if (log.projectId === projectId && log.runId === runId) {
        events.push({ timestamp: log.timestamp, id: log.id, type: 'LOG', data: log });
      }
    }

    for (const inc of incidents) {
      if (inc.projectId === projectId && inc.runId === runId) {
        events.push({ timestamp: inc.timestamp, id: inc.id, type: 'INCIDENT_EVENT', data: inc });
      }
    }

    return events.sort((a, b) => {
      const tDiff = a.timestamp.getTime() - b.timestamp.getTime();
      if (tDiff !== 0) return tDiff;
      return a.id.localeCompare(b.id);
    });
  }
}
