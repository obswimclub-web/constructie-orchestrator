import { randomUUID } from 'node:crypto';
import type { WorkItem } from '@co/domain';
import {
  assertVerificationCanCompleteWorkItem,
  type ArtifactRecord,
  type EvidenceRecord,
  type VerificationRecord,
  type VerificationStatus,
} from './records.js';

export interface EvidenceStore {
  saveArtifact(record: ArtifactRecord): Promise<ArtifactRecord>;
  saveEvidence(record: EvidenceRecord): Promise<EvidenceRecord>;
  saveVerification(record: VerificationRecord): Promise<VerificationRecord>;
  listEvidenceForWorkItem(projectId: string, workItemId: string): Promise<readonly EvidenceRecord[]>;
}

export interface VerificationWorkStore {
  transitionWorkItem(input: {
    workItemId: string;
    expectedRevision: number;
    to: 'COMPLETED' | 'REPAIR_REQUIRED' | 'RECOVERY_REQUIRED';
  }): Promise<WorkItem>;
}

export class EvidenceVerificationService {
  public constructor(
    private readonly evidenceStore: EvidenceStore,
    private readonly workStore: VerificationWorkStore,
  ) {}

  public async registerArtifact(input: Omit<ArtifactRecord, 'id' | 'createdAt'> & { now?: Date }): Promise<ArtifactRecord> {
    const now = input.now ?? new Date();
    return this.evidenceStore.saveArtifact({ ...input, id: randomUUID(), createdAt: now });
  }

  public async registerEvidence(input: Omit<EvidenceRecord, 'id' | 'createdAt'> & { now?: Date }): Promise<EvidenceRecord> {
    const now = input.now ?? new Date();
    return this.evidenceStore.saveEvidence({ ...input, id: randomUUID(), createdAt: now });
  }

  public async recordVerificationAndResolve(input: {
    workItem: WorkItem;
    verificationType: VerificationRecord['verificationType'];
    status: VerificationStatus;
    evidenceIds: readonly string[];
    verifierRef: string;
    now?: Date;
  }): Promise<{ verification: VerificationRecord; workItem: WorkItem }> {
    if (input.workItem.lifecycleState !== 'VERIFICATION_REQUIRED') {
      throw new Error(`WorkItem ${input.workItem.id} is not VERIFICATION_REQUIRED.`);
    }
    const now = input.now ?? new Date();
    const verification = await this.evidenceStore.saveVerification({
      id: randomUUID(),
      projectId: input.workItem.projectId,
      workItemId: input.workItem.id,
      verificationType: input.verificationType,
      status: input.status,
      evidenceIds: input.evidenceIds,
      verifierRef: input.verifierRef,
      verifiedAt: now,
      createdAt: now,
    });

    if (verification.status === 'PASS') {
      const evidence = await this.evidenceStore.listEvidenceForWorkItem(input.workItem.projectId, input.workItem.id);
      assertVerificationCanCompleteWorkItem({
        projectId: input.workItem.projectId,
        workItemId: input.workItem.id,
        verification,
        evidence,
      });
      const workItem = await this.workStore.transitionWorkItem({
        workItemId: input.workItem.id,
        expectedRevision: input.workItem.revision,
        to: 'COMPLETED',
      });
      return { verification, workItem };
    }

    const workItem = await this.workStore.transitionWorkItem({
      workItemId: input.workItem.id,
      expectedRevision: input.workItem.revision,
      to: verification.status === 'FAIL' ? 'REPAIR_REQUIRED' : 'RECOVERY_REQUIRED',
    });
    return { verification, workItem };
  }
}
