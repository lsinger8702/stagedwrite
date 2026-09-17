import type { createStagedWrite } from "../managed/engine.js";
import type { EditBatch, InitialIntent } from "../edit/protocol.js";
import type { DraftTypeDefinition } from "../registry/types.js";
import type { AgentToolName } from "./schema.js";
export type AgentEngine = ReturnType<typeof createStagedWrite>;
export interface AgentToolInputs {
  stagedwrite_create: { initialIntent: InitialIntent };
  stagedwrite_context: { draftId: string };
  stagedwrite_preview: { draftId: string; expectedVersion: number; batch: EditBatch };
  stagedwrite_edit: { draftId: string; expectedVersion: number; batch: EditBatch };
  stagedwrite_preflight: { draftId: string };
  stagedwrite_publish: { draftId: string; certificate: string };
  stagedwrite_resume: { draftId: string; runId: string };
}
export type AgentAuthorizationRequest = { [N in AgentToolName]: { tool: N; input: Readonly<AgentToolInputs[N]> } }[AgentToolName];
export interface AgentToolsOptions {
  engine: AgentEngine;
  /** The same trusted definition registered with this engine. */
  definition: DraftTypeDefinition;
  /** Bind user identity here; validate Draft ownership and allowed actions on every call. */
  authorize(request: AgentAuthorizationRequest): boolean | Promise<boolean>;
  /** Original exceptions stay with the host, not in model-visible results. */
  onError?(error: unknown): void | Promise<void>;
}
export interface AgentToolError {
  code: string;
  message: string;
  hint: string;
  issues?: readonly { path: string; message: string; hint?: string }[];
}
