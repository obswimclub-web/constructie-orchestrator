import { describe, expect, it } from 'vitest';
import { parseProviderOutput } from '../../packages/agents/src/codex/provider-output-parser.js';
import type { ParseContext } from '../../packages/agents/src/codex/provider-output-parser.js';

const ctx: ParseContext = {
  taskId: 'task-parser-001',
  agentId: 'codex-adapter',
  workPackageRef: 'wp-001',
  correlationId: 'corr-001',
};

describe('parseProviderOutput — MODEL_TEXT_IS_NOT_EXECUTABLE=true', () => {
  it('ordinary prose mentioning "git push" creates ZERO tool proposals', () => {
    const prose = `
      I will now proceed to run git push to deploy the changes.
      After that I'll do git commit and then git push origin main.
      The command git push origin main will push to remote.
    `;
    const result = parseProviderOutput(prose, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('prose with "TOOL_PROPOSAL: git.push" creates ZERO tool proposals (free-text rejected)', () => {
    const prose = 'TOOL_PROPOSAL: git.push target=remote://origin';
    const result = parseProviderOutput(prose, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('plain JSON object without code block creates ZERO proposals', () => {
    const prose = '{"toolProposals":[{"toolId":"git","operationId":"git.push","targetResource":"remote://origin","environment":"LOCAL"}]}';
    // No code block — not extracted
    const result = parseProviderOutput(prose, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('valid structured JSON block creates exactly the declared proposals', () => {
    const content = `
Here is my analysis of the task.

\`\`\`json
{
  "summary": "Implementation complete",
  "artifacts": [{ "type": "PATCH", "ref": "src/foo.ts" }],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.add",
      "targetResource": "src/foo.ts",
      "environment": "LOCAL",
      "parameters": { "filePaths": ["src/foo.ts"] }
    }
  ]
}
\`\`\`
    `;
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(1);
    expect(result.toolProposals[0]?.toolId).toBe('git');
    expect(result.toolProposals[0]?.operationId).toBe('git.add');
    expect(result.summary).toBe('Implementation complete');
  });

  it('multiple valid proposals parsed deterministically in order', () => {
    const content = `
\`\`\`json
{
  "summary": "Two actions needed",
  "artifacts": [],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.add",
      "targetResource": "src/a.ts",
      "environment": "LOCAL",
      "parameters": {}
    },
    {
      "toolId": "git",
      "operationId": "git.commit",
      "targetResource": "repo://local",
      "environment": "LOCAL",
      "parameters": { "message": "feat: add a.ts" }
    }
  ]
}
\`\`\`
    `;
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(2);
    expect(result.toolProposals[0]?.operationId).toBe('git.add');
    expect(result.toolProposals[1]?.operationId).toBe('git.commit');
  });

  it('malformed JSON in code block creates ZERO proposals (fail closed)', () => {
    const content = '```json\n{ "toolProposals": [{ invalid json }] }\n```';
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('incomplete proposal (missing required field) fails closed', () => {
    const content = `
\`\`\`json
{
  "summary": "attempt",
  "artifacts": [],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.push"
    }
  ]
}
\`\`\`
    `;
    // Missing targetResource and environment — fails Zod validation → fail closed
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('unknown field in proposal fails closed (strict mode)', () => {
    const content = `
\`\`\`json
{
  "summary": "test",
  "artifacts": [],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.push",
      "targetResource": "origin",
      "environment": "LOCAL",
      "parameters": {},
      "dangerouslyExecute": true
    }
  ]
}
\`\`\`
    `;
    // Extra field — strict mode rejects entire proposal → fail closed
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('unknown environment value fails closed', () => {
    const content = `
\`\`\`json
{
  "summary": "test",
  "artifacts": [],
  "toolProposals": [
    {
      "toolId": "git",
      "operationId": "git.push",
      "targetResource": "origin",
      "environment": "PROD_BYPASS",
      "parameters": {}
    }
  ]
}
\`\`\`
    `;
    const result = parseProviderOutput(content, ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('empty code block fails closed', () => {
    const result = parseProviderOutput('```json\n```', ctx);
    expect(result.toolProposals).toHaveLength(0);
  });

  it('no code block returns empty proposals with summary as truncated prose', () => {
    const prose = 'This is a response with no structured output.';
    const result = parseProviderOutput(prose, ctx);
    expect(result.toolProposals).toHaveLength(0);
    expect(result.summary).toContain('This is a response');
  });
});
