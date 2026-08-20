export interface ProjectEvent<TPayload = unknown> {
  readonly id: string;
  readonly projectId: string;
  readonly eventType: string;
  readonly aggregateType: "PROJECT";
  readonly aggregateId: string;
  readonly aggregateRevision: number;
  readonly actorType: "OWNER" | "HUMAN_USER" | "ORCHESTRATOR" | "AGENT" | "SYSTEM" | "EXTERNAL_ACTOR";
  readonly actorId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly schemaVersion: number;
  readonly payload: TPayload;
  readonly occurredAt: Date;
}
