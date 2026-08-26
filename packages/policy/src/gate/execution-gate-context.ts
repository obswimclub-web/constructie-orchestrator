import type {
  ExecutionGate,
  Environment,
  OwnerAuthorityToken,
} from '../types.js';

/**
 * Holds the current lifecycle gate, active owner authority tokens,
 * approved file scope, and environment for a single execution session.
 *
 * INVARIANT: The agent cannot self-promote to a higher gate.
 * Gate transitions require explicit external calls (owner actions),
 * not model-generated prose.
 */
export class ExecutionGateContext {
  private _gate: ExecutionGate;
  private readonly _authorityTokens: Set<OwnerAuthorityToken>;
  private readonly _approvedFileScope: Set<string>;
  private _environment: Environment;
  private readonly _auditLog: Array<{ at: Date; event: string }> = [];

  public constructor(options: {
    initialGate: ExecutionGate;
    environment: Environment;
    initialTokens?: readonly OwnerAuthorityToken[];
    approvedFileScope?: readonly string[];
  }) {
    this._gate = options.initialGate;
    this._environment = options.environment;
    this._authorityTokens = new Set(options.initialTokens ?? []);
    this._approvedFileScope = new Set(options.approvedFileScope ?? []);
    this._auditLog.push({ at: new Date(), event: `GATE_INIT:${this._gate}` });
  }

  // ─── Read accessors ───────────────────────────────────────────────────────

  public get gate(): ExecutionGate { return this._gate; }
  public get environment(): Environment { return this._environment; }

  public hasAuthority(token: OwnerAuthorityToken): boolean {
    return this._authorityTokens.has(token);
  }

  public isFileApproved(filePath: string): boolean {
    if (this._approvedFileScope.size === 0) return false;
    return this._approvedFileScope.has(filePath);
  }

  public get approvedFileScope(): ReadonlySet<string> {
    return this._approvedFileScope;
  }

  public get activeTokens(): readonly OwnerAuthorityToken[] {
    return [...this._authorityTokens];
  }

  // ─── Mutations (owner-driven only) ────────────────────────────────────────

  /**
   * Grant an authority token.
   * Must be called as the result of an explicit owner approval,
   * never as a result of model-generated prose.
   */
  public grantAuthority(token: OwnerAuthorityToken): void {
    this._authorityTokens.add(token);
    this._auditLog.push({ at: new Date(), event: `AUTHORITY_GRANTED:${token}` });
  }

  /**
   * Revoke an authority token (e.g. after the authorized action is complete).
   */
  public revokeAuthority(token: OwnerAuthorityToken): void {
    this._authorityTokens.delete(token);
    this._auditLog.push({ at: new Date(), event: `AUTHORITY_REVOKED:${token}` });
  }

  /**
   * Transition to a new gate.
   * Self-promotion is structurally blocked: a provider cannot call this
   * on its own — this must be wired to an owner-gated control plane event.
   */
  public transitionGate(newGate: ExecutionGate): void {
    const previous = this._gate;
    this._gate = newGate;
    this._auditLog.push({ at: new Date(), event: `GATE_TRANSITION:${previous}→${newGate}` });
  }

  /**
   * Set the exact approved file scope for the current gate.
   * Replaces any previous scope.
   */
  public setApprovedFileScope(files: readonly string[]): void {
    this._approvedFileScope.clear();
    for (const f of files) this._approvedFileScope.add(f);
    this._auditLog.push({ at: new Date(), event: `FILE_SCOPE_SET:${files.length} files` });
  }

  public addApprovedFile(filePath: string): void {
    this._approvedFileScope.add(filePath);
    this._auditLog.push({ at: new Date(), event: `FILE_APPROVED:${filePath}` });
  }

  public setEnvironment(env: Environment): void {
    this._environment = env;
    this._auditLog.push({ at: new Date(), event: `ENVIRONMENT_SET:${env}` });
  }

  public auditLog(): readonly { at: Date; event: string }[] {
    return this._auditLog;
  }
}
