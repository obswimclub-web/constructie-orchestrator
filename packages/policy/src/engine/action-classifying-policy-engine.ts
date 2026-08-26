import {
  ActionClassifier,
  AuthCredentialScriptGuard,
  SecretFileGuard,
  SecretLiteralGuard,
  SecretOutputGuard,
} from '../classification/action-classifier.js';
import type { ExecutionGateContext } from '../gate/execution-gate-context.js';
import type {
  ActionPolicyDecision,
  ActionPolicyEvaluator,
  ActionRequest,
  ExecutionGate,
  GateRule,
  MutationClass,
  OwnerAuthorityToken,
} from '../types.js';

// ─── Gate Policy Matrix ────────────────────────────────────────────────────────

/**
 * The authoritative gate × mutation-class policy matrix.
 *
 * FAIL-CLOSED: any class not in allowedClasses for the current gate is DENIED.
 * UNKNOWN class always → REQUIRE_APPROVAL.
 */
const GATE_POLICY: Record<ExecutionGate, GateRule> = {
  AUDIT: {
    allowedClasses: ['READ_ONLY', 'PRODUCTION_READ'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT',
      'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  PLAN: {
    allowedClasses: ['READ_ONLY'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'PRODUCTION_READ',
      'DATABASE_MUTATION', 'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION',
      'SECRET_READ', 'SECRET_OUTPUT', 'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  OWNER_PLAN_REVIEW: {
    allowedClasses: ['READ_ONLY'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'PRODUCTION_READ',
      'DATABASE_MUTATION', 'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION',
      'SECRET_READ', 'SECRET_OUTPUT', 'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  IMPLEMENTATION: {
    allowedClasses: ['READ_ONLY', 'LOCAL_MUTATION', 'SOURCE_MUTATION'],
    deniedClasses: [
      'GIT_COMMIT', 'GIT_PUSH', 'GIT_DESTRUCTIVE', 'DEPLOYMENT',
      'PRODUCTION_MUTATION', 'PRODUCTION_READ', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT', 'DESTRUCTIVE',
    ],
    requiredTokens: {
      SOURCE_MUTATION: 'OWNER_IMPLEMENTATION_APPROVED',
    },
    enforceFileScope: true,
  },
  TEST: {
    allowedClasses: ['READ_ONLY', 'LOCAL_MUTATION', 'DATABASE_READ'],
    deniedClasses: [
      'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH', 'GIT_DESTRUCTIVE',
      'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION', 'SCHEMA_MUTATION',
      'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  OWNER_PRECOMMIT: {
    allowedClasses: ['READ_ONLY'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT',
      'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  COMMIT: {
    allowedClasses: ['READ_ONLY', 'GIT_STAGE', 'GIT_COMMIT'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_PUSH', 'GIT_DESTRUCTIVE', 'DEPLOYMENT',
      'PRODUCTION_MUTATION', 'DATABASE_MUTATION', 'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION',
      'SECRET_READ', 'SECRET_OUTPUT', 'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {
      GIT_STAGE: 'OWNER_COMMIT_APPROVED',
      GIT_COMMIT: 'OWNER_COMMIT_APPROVED',
    },
    enforceFileScope: true, // exact file scope enforced
  },
  PUSH: {
    allowedClasses: ['READ_ONLY', 'GIT_PUSH'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_DESTRUCTIVE',
      'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION', 'SCHEMA_MUTATION',
      'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT', 'CREDENTIAL_USE',
      'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {
      GIT_PUSH: 'OWNER_PUSH_APPROVED',
    },
    enforceFileScope: false,
  },
  DEPLOY: {
    allowedClasses: ['READ_ONLY', 'DEPLOYMENT'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION', 'SCHEMA_MUTATION',
      'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT', 'CREDENTIAL_USE',
      'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {
      DEPLOYMENT: 'OWNER_DEPLOY_APPROVED',
    },
    enforceFileScope: false,
  },
  PRODUCTION_VALIDATION: {
    allowedClasses: ['READ_ONLY', 'PRODUCTION_READ'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT',
      'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  PRODUCTION_VALIDATION_READ_ONLY: {
    allowedClasses: ['READ_ONLY', 'PRODUCTION_READ'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT',
      'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
  OWNER_FINAL_CLOSURE: {
    allowedClasses: ['READ_ONLY'],
    deniedClasses: [
      'LOCAL_MUTATION', 'SOURCE_MUTATION', 'GIT_STAGE', 'GIT_COMMIT', 'GIT_PUSH',
      'GIT_DESTRUCTIVE', 'DEPLOYMENT', 'PRODUCTION_MUTATION', 'DATABASE_MUTATION',
      'SCHEMA_MUTATION', 'SCHEMA_SOURCE_MUTATION', 'SECRET_READ', 'SECRET_OUTPUT',
      'CREDENTIAL_USE', 'AUTH_SESSION_CREATION', 'DESTRUCTIVE',
    ],
    requiredTokens: {},
    enforceFileScope: false,
  },
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * ActionClassifyingPolicyEngine
 *
 * The authoritative pre-execution enforcement layer.
 *
 * Evaluation order:
 * 1. Run all guards (secret file/output/literal/auth-credential).
 *    Guard violations are HARD DENY — not subject to gate or token overrides.
 * 2. Classify the action into MutationClasses.
 * 3. Check for UNKNOWN class → REQUIRE_APPROVAL (fail-closed).
 * 4. Resolve current gate from ExecutionGateContext.
 * 5. Check each class against the gate's deniedClasses.
 * 6. Check each class against the gate's allowedClasses.
 * 7. For classes in allowedClasses, check requiredTokens.
 * 8. If enforceFileScope: verify requested file paths ⊆ approvedFileScope.
 * 9. ALLOW only when all checks pass.
 *
 * HARD DENY semantics: when decision = DENY, the tool adapter is NEVER called.
 * This is enforced at the GovernedToolGateway layer, not just returned as a hint.
 */
export class ActionClassifyingPolicyEngine implements ActionPolicyEvaluator {
  private readonly classifier = new ActionClassifier();
  private readonly secretFileGuard = new SecretFileGuard();
  private readonly secretOutputGuard = new SecretOutputGuard();
  private readonly secretLiteralGuard = new SecretLiteralGuard();
  private readonly authCredentialScriptGuard = new AuthCredentialScriptGuard();

  public constructor(private readonly gateContext: ExecutionGateContext) {}

  public async evaluate(request: ActionRequest): Promise<ActionPolicyDecision> {
    const gate = this.gateContext.gate;

    // ── Step 1: Guard checks (hard-deny, always evaluated) ──────────────────
    const guards = [
      this.secretFileGuard.check(request),
      this.secretOutputGuard.check(request),
      this.secretLiteralGuard.check(request),
      this.authCredentialScriptGuard.check(request),
    ];

    for (const violation of guards) {
      if (violation) {
        return this.deny(request, [], gate, violation.ruleCode,
          `Guard '${violation.guardName}' triggered: ${violation.detail}`,
        );
      }
    }

    // ── Step 2: Classification ────────────────────────────────────────────────
    const classes = this.classifier.classify(request);

    // ── Step 3: Fail-closed on UNKNOWN ────────────────────────────────────────
    if (classes.includes('UNKNOWN')) {
      return {
        actionId: request.actionId,
        decision: 'REQUIRE_APPROVAL',
        policyRule: 'AMBIGUOUS_CLASSIFICATION_FAIL_CLOSED',
        currentGate: gate,
        triggeringClasses: ['UNKNOWN'],
        allClasses: classes,
        reason:
          'Action could not be definitively classified. ' +
          'Fail-closed policy requires explicit owner approval before execution.',
      };
    }

    const gateRule = GATE_POLICY[gate];

    // ── Step 4 & 5: Check denied classes (hard deny for this gate) ────────────
    for (const cls of classes) {
      if (gateRule.deniedClasses.includes(cls)) {
        return this.deny(request, classes, gate,
          `${cls}_NOT_ALLOWED_IN_GATE_${gate}`,
          `Class '${cls}' is explicitly denied in gate '${gate}'.`,
        );
      }
    }

    // ── Step 6: Check allowed classes (if not in allowed → deny) ─────────────
    for (const cls of classes) {
      if (!gateRule.allowedClasses.includes(cls)) {
        return this.deny(request, classes, gate,
          `${cls}_NOT_IN_ALLOWED_SET_FOR_GATE_${gate}`,
          `Class '${cls}' is not in the allowed set for gate '${gate}'. ` +
          `Allowed: ${gateRule.allowedClasses.join(', ')}.`,
        );
      }
    }

    // ── Step 7: Authority token checks ───────────────────────────────────────
    for (const cls of classes) {
      const requiredToken = gateRule.requiredTokens[cls as MutationClass];
      if (requiredToken && !this.gateContext.hasAuthority(requiredToken)) {
        return {
          actionId: request.actionId,
          decision: 'DENY',
          policyRule: `${requiredToken}_REQUIRED`,
          currentGate: gate,
          requiredAuthority: requiredToken,
          triggeringClasses: [cls],
          allClasses: classes,
          reason:
            `Class '${cls}' in gate '${gate}' requires authority token '${requiredToken}', ` +
            `which has not been granted. Owner must explicitly authorize this action.`,
        };
      }
    }

    // ── Step 8: File scope enforcement ────────────────────────────────────────
    if (gateRule.enforceFileScope && request.requestedFilePaths && request.requestedFilePaths.length > 0) {
      for (const filePath of request.requestedFilePaths) {
        if (!this.gateContext.isFileApproved(filePath)) {
          return this.deny(request, classes, gate,
            'FILE_NOT_IN_APPROVED_SCOPE',
            `File path '${filePath}' is not in the approved file scope for gate '${gate}'. ` +
            `Approved files: [${[...this.gateContext.approvedFileScope].join(', ')}].`,
          );
        }
      }
    }

    // ── ALLOW ─────────────────────────────────────────────────────────────────
    return {
      actionId: request.actionId,
      decision: 'ALLOW',
      policyRule: 'GATE_POLICY_ALLOW',
      currentGate: gate,
      triggeringClasses: [],
      allClasses: classes,
      reason: `All ${classes.length} class(es) [${classes.join(', ')}] are allowed in gate '${gate}'.`,
    };
  }

  private deny(
    request: ActionRequest,
    classes: readonly MutationClass[],
    gate: ExecutionGate,
    rule: string,
    reason: string,
    requiredAuthority?: OwnerAuthorityToken,
  ): ActionPolicyDecision {
    return {
      actionId: request.actionId,
      decision: 'DENY',
      policyRule: rule,
      currentGate: gate,
      requiredAuthority,
      triggeringClasses: classes.length > 0 ? classes : ['UNKNOWN'],
      allClasses: classes,
      reason,
    };
  }
}
