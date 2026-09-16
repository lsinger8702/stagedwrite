import type { Value } from "../types.js";

export type ScalarType = "string" | "number" | "integer" | "boolean";
export interface ScalarSchema {
  type: ScalarType | readonly [ScalarType, "null"] | readonly ["null", ScalarType];
  title?: string;
  description?: string;
  enum?: readonly Value[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
}
export interface ObjectSchema {
  type: "object" | readonly ["object", "null"] | readonly ["null", "object"];
  properties: Readonly<Record<string, FieldSchema>>;
  additionalProperties: false;
  title?: string;
  description?: string;
}
export interface ArraySchema {
  type: "array" | readonly ["array", "null"] | readonly ["null", "array"];
  items: FieldSchema;
  minItems?: number;
  maxItems?: number;
  title?: string;
  description?: string;
}
export type FieldSchema = ScalarSchema | ObjectSchema | ArraySchema | { $ref: string };
export interface ValueSchema {
  $schema?: "https://json-schema.org/draft/2020-12/schema";
  type: "object";
  title?: string;
  description?: string;
  $defs?: Readonly<Record<string, FieldSchema>>;
  properties: Readonly<Record<string, FieldSchema>>;
  additionalProperties: false;
}
export interface DraftTypeDefinition {
  id: string;
  version: string;
  nodeTypes: Readonly<Record<string, {
    valueSchema: ValueSchema;
    requiredAtPublish?: readonly string[];
  }>>;
  relationTypes: Readonly<Record<string, {
    from: readonly string[];
    to: readonly string[];
    /** Required by the new topology evaluator; legacy entry removal is tracked in M05. */
    ownership?: "owned" | "reference";
    cardinality?: "one" | "many";
  }>>;
}
export interface DefinitionSelector { type: string; typeVersion: string }
export type DefinitionErrorCode = "INVALID_DEFINITION" | "UNSUPPORTED_SCHEMA_FEATURE"
  | "SCHEMA_REF_NOT_FOUND" | "SCHEMA_REF_CYCLE" | "DEFINITION_CONFLICT";
export interface DefinitionIssue {
  code: DefinitionErrorCode;
  definitionId: string;
  version: string;
  path: string;
  message: string;
  target?: string;
  chain?: string[];
}
export interface ValueIssue { path: string; keyword: string; message: string }

/** Type assistance only. The assembly function validates even ordinary JSON input. */
export function defineDraftType<const T extends DraftTypeDefinition>(definition: T): T { return definition; }
