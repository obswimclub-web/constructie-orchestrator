import { ConcreteStructuredReviewer } from './concrete-structured-reviewer.js';
import { RunCoordinator, InMemoryEventLedger } from '@co/workflow';
import { CodexAdapter, AntigravityPythonBridge } from '@co/agents';
import {
  ActionClassifyingPolicyEngine,
  InMemoryExecutionAuditLedger,
  OwnerEventProcessor,
  TrustedOwnerAuthorityIssuer,
  type ActionAuditLedger,
  type Environment,
  type ExecutionGate,
  type ReadOnlyExecutionContext,
} from '@co/policy';
import {
  SandboxFilesystemAdapter,
} from '@co/tools';
import {
  createProductionGateway,
  type GovernedToolGateway,
} from '@co/tools';

/**
 * RuntimeComposition
 *
 * The typed result of createRuntimeComposition().
 *
 * CAPABILITY GRAPH:
 *
 *   issuer            → composition root only (create authority events)
 *   ownerProcessor    → composition root only (apply events, revoke grants)
 *   gateway           → passed to CodexAdapter; also available for direct test use
 *   codexAdapter      → passed to MinimalWorkflowEngine
 *   auditLedger       → read by evidence/verification layer
 *   policyView        → read-only; passed to any code that needs to inspect context
 *
 * The codexAdapter receives ONLY the gateway — not the issuer, not the processor.
 * The policyEngine receives ONLY the read-only view — not the processor.
 */
export interface RuntimeComposition {
  readonly runCoordinator: RunCoordinator;
  readonly reviewer: ConcreteStructuredReviewer;
  /** Control-plane issuer — composition root only */
  readonly issuer: TrustedOwnerAuthorityIssuer;
  /** Event processor — composition root only */
  readonly ownerProcessor: OwnerEventProcessor;
  /** Production gateway (ActionPolicyEvaluator-enforced) */
  readonly gateway: GovernedToolGateway;
  /** Agent adapter (receives gateway only) */
  readonly codexAdapter: CodexAdapter;
  /** Audit ledger */
  readonly auditLedger: ActionAuditLedger;
  /** Read-only view of execution context (safe to share with agents) */
  readonly policyView: ReadOnlyExecutionContext;
}

/**
 * createRuntimeComposition
 *
 * The canonical wiring factory for internal Orchestrator execution.
 *
 * Structural invariant enforced by TypeScript:
 *   - CodexAdapter receives ToolGateway only — no raw adapters, no processor.
 *   - ActionClassifyingPolicyEngine receives ReadOnlyExecutionContext only.
 *   - createProductionGateway() requires ActionPolicyEvaluator — no StaticToolPolicy.
 *
 * CANONICAL_INTERNAL_RUNTIME_COMPOSITION_REQUIRES_ACTION_POLICY=true
 * PRODUCTION_RUNTIME_EXISTS=false (apps/api and apps/worker are stubs)
 * CANONICAL_RUNTIME_WIRING_TARGET=this function
 */
import type { PrismaEventLedger } from '@co/persistence';

export function createRuntimeComposition(options: {
  ledger: PrismaEventLedger;
  taskId: string;
  ownerRef?: string;
  initialGate?: ExecutionGate;
  environment?: Environment;
}): RuntimeComposition {
  // 1. Control-plane: TrustedOwnerAuthorityIssuer (issuer of canonical events)
  const issuer = new TrustedOwnerAuthorityIssuer(
    options.ownerRef ?? 'owner:system',
    options.taskId,
  );

  // 2. Control-plane: OwnerEventProcessor (validates events, manages grant state)
  const ownerProcessor = new OwnerEventProcessor({
    taskId: options.taskId,
    initialGate: options.initialGate ?? 'AUDIT',
    environment: options.environment ?? 'LOCAL',
  });

  // 3. Read-only view (safe for agents and policy engine — no mutations)
  const policyView = ownerProcessor.readOnlyView;

  // 4. Audit ledger
  const auditLedger = new InMemoryExecutionAuditLedger();

  // 5. Policy engine — receives READ-ONLY view; no processor reference
  const policyEngine = new ActionClassifyingPolicyEngine(policyView);

  // 6. Grant consumer — for gateway post-execution lifecycle; NOT passed to agents
  const grantConsumer = ownerProcessor.asGrantConsumer();

  // 7. Tool adapters
  const adapters = [
    new SandboxFilesystemAdapter([]),
    // Future: ShellAdapter, GitAdapter, HttpAdapter
  ] as const;

  // 8. Production gateway — enforces ActionPolicyEvaluator (no StaticToolPolicy path)
  const gateway = createProductionGateway(policyEngine, adapters, auditLedger, grantConsumer);

  // 9. Agent adapter — receives gateway only; no raw adapter refs, no processor
  const codexAdapter = new CodexAdapter(gateway);

    const reviewer = new ConcreteStructuredReviewer();
  const runCoordinator = new RunCoordinator(new AntigravityPythonBridge(), options.ledger, reviewer, options.taskId);

  return {
    issuer,
    ownerProcessor,
    runCoordinator,
    reviewer,
    gateway,
    codexAdapter,
    auditLedger,
    policyView,
  };
}
