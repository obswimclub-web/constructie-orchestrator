import type {
  ActionAuditLedger,
  AuditEntry,
  AuditEntryProposed,
} from '../types.js';

/**
 * In-memory, append-only execution audit ledger.
 *
 * Records every proposed action (with its classification and policy decision),
 * and the eventual execution result.
 *
 * For DENIED actions, executionResult is always 'NOT_EXECUTED' — providing
 * a tamper-evident record that the tool adapter was never called.
 */
export class InMemoryExecutionAuditLedger implements ActionAuditLedger {
  private readonly _entries = new Map<string, AuditEntry>();

  public recordProposed(entry: AuditEntryProposed): void {
    this._entries.set(entry.actionId, {
      ...entry,
      executedAt: undefined,
      executionResult: undefined,
    });
  }

  public recordExecuted(
    actionId: string,
    result: 'SUCCEEDED' | 'FAILED' | 'DENIED' | 'NOT_EXECUTED',
  ): void {
    const existing = this._entries.get(actionId);
    if (existing) {
      this._entries.set(actionId, {
        ...existing,
        executedAt: new Date(),
        executionResult: result,
      });
    }
  }

  public entries(): readonly AuditEntry[] {
    return [...this._entries.values()];
  }

  public countByResult(result: AuditEntry['executionResult']): number {
    return [...this._entries.values()].filter((e) => e.executionResult === result).length;
  }

  public denied(): readonly AuditEntry[] {
    return [...this._entries.values()].filter((e) => e.executionResult === 'NOT_EXECUTED');
  }
}
