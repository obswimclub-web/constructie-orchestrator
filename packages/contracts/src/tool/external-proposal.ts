import { z } from 'zod';

export const ExternalHostToolProposalSchema = z.object({
  tool: z.string(),
  operation: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()),
  nonce: z.string().optional(), // For IPC transport auth
});

export type ExternalHostToolProposal = z.infer<typeof ExternalHostToolProposalSchema>;
