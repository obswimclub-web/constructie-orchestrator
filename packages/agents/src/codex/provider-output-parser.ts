import { z } from 'zod';

/**
 * StructuredProviderOutput — canonical output contract for provider agents.
 *
 * Providers (e.g. CodexAdapter) must extract a JSON block conforming to this
 * schema from their LLM response. Any tool proposals must appear in the
 * `toolProposals` array with all required fields.
 *
 * SECURITY INVARIANTS:
 *   MODEL_TEXT_IS_NOT_EXECUTABLE=true
 *   ONLY_SCHEMA_VALID_TOOL_PROPOSAL_IS_EXECUTABLE=true
 *
 *   - Ordinary prose mentioning "git push" creates ZERO ToolProposals.
 *   - A malformed, incomplete, unknown, or ambiguous proposal fails CLOSED.
 *   - No ad-hoc free-text parsing. Strict Zod schema validation only.
 *   - Unknown fields in the JSON envelope are rejected (strict mode).
 */

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const ArtifactRefSchema = z.object({
  type: z.string().min(1),
  ref:  z.string().min(1),
}).strict();

/**
 * A structured tool proposal produced by the LLM.
 * ALL fields are required — no partial proposals are accepted.
 * Failing any field → the proposal is dropped and treated as non-executable.
 */
const ALLOWED_OPERATIONS: Record<string, readonly string[]> = {
  'git': ['git.add', 'git.commit', 'git.push'],
  'shell': ['shell.exec'],
  'sandbox-filesystem': ['filesystem.read', 'filesystem.write'],
  // Allow mock-tool strictly for testing provider-output-parser if needed, though we can omit it if tests don't need it.
  // Wait, parser tests use git.push so we're good.
};

const ToolProposalSchema = z.object({
  toolId:         z.string().min(1),
  operationId:    z.string().min(1),
  targetResource: z.string().min(1),
  environment:    z.enum(['LOCAL', 'TEST', 'STAGING', 'PRODUCTION']),
  parameters:     z.record(z.string(), z.unknown()).default({}),
}).strict().superRefine((data, ctx) => {
  const allowedOps = ALLOWED_OPERATIONS[data.toolId];
  if (!allowedOps) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `UNKNOWN_TOOL_REJECTED`,
      path: ['toolId'],
    });
    return;
  }
  if (!allowedOps.includes(data.operationId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `UNSUPPORTED_TOOL_OPERATION_COMBINATION_REJECTED`,
      path: ['operationId'],
    });
  }
});

const StructuredProviderOutputSchema = z.object({
  summary:       z.string(),
  artifacts:     z.array(ArtifactRefSchema).default([]),
  toolProposals: z.array(ToolProposalSchema).default([]),
}).strict();

// ─── Exported types ───────────────────────────────────────────────────────────

export type ArtifactRef = z.infer<typeof ArtifactRefSchema>;
export type ToolProposal = z.infer<typeof ToolProposalSchema>;
export type StructuredProviderOutput = z.infer<typeof StructuredProviderOutputSchema>;

// ─── JSON code block extraction ───────────────────────────────────────────────

/**
 * Extracts a JSON code block from a fenced markdown block.
 * Matches ```json ... ``` or ``` ... ``` (first occurrence only).
 *
 * Returns the raw JSON string if found, otherwise null.
 * NO evaluation of the content occurs here — parsing is done separately.
 */
function extractJsonBlock(content: string): string | null {
  // Match ```json ... ``` or ``` ... ```
  const match = /```(?:json)?\s*\n([\s\S]*?)```/.exec(content);
  if (match && match[1]) return match[1].trim();
  return null;
}

// ─── Parse context ────────────────────────────────────────────────────────────

export interface ParseContext {
  readonly taskId: string;
  readonly agentId: string;
  readonly workPackageRef: string;
  readonly correlationId: string;
}

// ─── parseProviderOutput ─────────────────────────────────────────────────────

/**
 * Parses a raw LLM response string into a StructuredProviderOutput.
 *
 * Algorithm:
 *   1. Look for a JSON code block (```json ... ``` or ``` ... ```).
 *   2. If found, attempt JSON.parse + Zod schema validation (strict).
 *   3. If any step fails (no block, invalid JSON, schema mismatch) →
 *      return a safe fallback with the raw text as summary and NO tool proposals.
 *
 * FAIL-CLOSED: partial proposals, unknown fields, missing required fields,
 * and non-JSON prose all result in toolProposals = [].
 *
 * The production code path exercised by the E2E test is the same path used
 * for all real LLM responses — no test-only hooks.
 *
 * @param rawContent  The raw LLM response string.
 * @param _context    Unused in V1; reserved for future trace correlation.
 */
export function parseProviderOutput(
  rawContent: string,
  _context?: ParseContext,
): StructuredProviderOutput {
  void _context;
  const fallback: StructuredProviderOutput = {
    summary:       rawContent.slice(0, 1000),
    artifacts:     [],
    toolProposals: [],
  };

  // Step 1: Extract JSON block
  const jsonBlock = extractJsonBlock(rawContent);
  if (!jsonBlock) return fallback;

  // Step 2: Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch {
    return fallback;
  }

  // Step 3: Validate against strict schema
  const result = StructuredProviderOutputSchema.safeParse(parsed);
  if (!result.success) {
    // Fail closed — malformed / incomplete / unknown-field proposal
    return fallback;
  }

  return result.data;
}
