export class StaleProjectRevisionError extends Error {
  public readonly code = "PROJECT_REVISION_CONFLICT";

  public constructor(
    public readonly projectId: string,
    public readonly expectedRevision: number,
  ) {
    super(`Project ${projectId} is no longer at expected revision ${expectedRevision}.`);
    this.name = "StaleProjectRevisionError";
  }
}
