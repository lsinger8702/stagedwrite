import { createHash } from "node:crypto";

export type Json = null | string | number | boolean | Json[] | { [key: string]: Json };
export const pointer = (key: string): string => key.replaceAll("~", "~0").replaceAll("/", "~1");
export const isObject = (value: unknown): value is Record<string, Json> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const forbidden = new Set(["__proto__", "prototype", "constructor"]);

/** Reject non-JSON input rather than letting JSON.stringify silently drop or coerce it. */
export function jsonSnapshot(input: unknown, report: (path: string, message: string) => void): Json | undefined {
  const visiting = new Set<object>();
  function copy(value: unknown, path: string, depth: number): Json | undefined {
    if (depth > 128) { report(path, "JSON nesting exceeds 128 levels"); return; }
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return Object.is(value, -0) ? 0 : value;
    if (typeof value !== "object" || value === null) { report(path, "Expected finite JSON data"); return; }
    if (visiting.has(value)) { report(path, "Cyclic JSON input"); return; }
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      report(path, "Expected a plain JSON object"); return;
    }
    visiting.add(value);
    const output: Json[] | Record<string, Json> = array ? [] : {};
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") continue;
      if (typeof key !== "string") { report(path, "Symbol keys are not JSON"); continue; }
      const at = `${path}/${pointer(key)}`;
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !("value" in descriptor)) { report(at, "Only enumerable data properties are allowed"); continue; }
      if (forbidden.has(key)) { report(at, "Unsafe object key"); continue; }
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length)) {
        report(at, "Named array properties are not JSON"); continue;
      }
      const item = copy(descriptor.value, at, depth + 1);
      if (item !== undefined) Object.defineProperty(output, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
    if (array) {
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) report(`${path}/${i}`, "Sparse arrays are not JSON");
      }
    }
    visiting.delete(value);
    return output;
  }
  return copy(input, "", 0);
}

/** stagedwrite-json-v1: UTF-16 key ordering; ECMAScript JSON primitive encoding.
 * Arrays retain order, finite IEEE-754 numbers only, -0 becomes 0; no Unicode normalization.
 * This is a versioned project format, not a claim of RFC 8785 conformance. */
export function canonicalJson(value: Json): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k]!)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function definitionDigest(value: Json): string {
  return `sha256:stagedwrite-json-v1:${createHash("sha256").update(canonicalJson(value), "utf8").digest("hex")}`;
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
