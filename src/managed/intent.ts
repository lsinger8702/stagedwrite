import { definitionDigest, type Json } from "../registry/json.js";
import type { IntentSnapshot } from "./types.js";
export const same = (a: unknown, b: unknown) => definitionDigest(a as Json) === definitionDigest(b as Json);
export const snapshot = (d: IntentSnapshot): IntentSnapshot => structuredClone({ graph: d.graph, fieldIntents: d.fieldIntents });
