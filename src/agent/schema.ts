import { deepFreeze } from "../registry/json.js";
import { editBatchSchema, initialIntentSchema } from "../edit/tool-schema.js";
const str = { type: "string", minLength: 1 };
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({ type: "object", properties, required, additionalProperties: false });
const { $schema: _initialDialect, $defs: initialDefs, ...initialBody } = initialIntentSchema;
const { $schema: _editDialect, $defs: editDefs, ...editBody } = editBatchSchema;
const version = { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER };
const schema = (body: unknown, defs?: unknown) => ({ $schema: "https://json-schema.org/draft/2020-12/schema", ...body as object, ...(defs ? { $defs: defs } : {}) });
export const agentToolDefinitions = deepFreeze([
  { name: "stagedwrite_create", description: "Create a Draft containing the user's initial intent. Use draftDefinition for fields and relations; do not create a replacement for an unresolved Run.", inputSchema: schema(object({ initialIntent: initialBody }), initialDefs) },
  { name: "stagedwrite_context", description: "Read current Draft version and full intent preview. This is not preflight and does not grant a publish certificate.", inputSchema: schema(object({ draftId: str })) },
  { name: "stagedwrite_preview", description: "Preview a set/remove/reset edit without saving. Proposed refs and version are not committed identities.", inputSchema: schema(object({ draftId: str, expectedVersion: version, batch: editBody }), editDefs) },
  { name: "stagedwrite_edit", description: "Apply an explicit three-state OP batch at the expected version. Returns a receipt; preflight again. On version conflict read context and replan, never blindly replay.", inputSchema: schema(object({ draftId: str, expectedVersion: version, batch: editBody }), editDefs) },
  { name: "stagedwrite_preflight", description: "Check current intent and return its full preview and targeted diagnostics. Pending/incomplete/blocked are not publish permission. Suggestions require a decision, never automatic repair.", inputSchema: schema(object({ draftId: str })) },
  { name: "stagedwrite_publish", description: "Publish a checked intent with its certificate, or observe its prior adoption. An unfinished Run continues through resume; host authorization is separate from the certificate.", inputSchema: schema(object({ draftId: str, certificate: str })) },
  { name: "stagedwrite_resume", description: "Continue the same unfinished Run. Unknown requests must be reconciled, not recreated. Completed Runs are observed only.", inputSchema: schema(object({ draftId: str, runId: str })) },
] as const);
export type AgentToolName = typeof agentToolDefinitions[number]["name"];
