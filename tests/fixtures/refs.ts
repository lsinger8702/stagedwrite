import assert from "node:assert/strict";
import type { CreateReceipt, ManagedDraft } from "../../src/index.js";
// Test applications give root positions business aliases using the actual create
// receipt. No generated identity is replaced, and no request protocol is adapted.
const roots = new Map<string, Record<string, string>>();
export function rememberRefs(result: CreateReceipt<ManagedDraft>, labels: string[]): ManagedDraft {
    const refs = Object.fromEntries(labels.map((label, i) => {
        const entry = result.createdRefs.find(r => r.path === `/roots/${i}`);
        assert.ok(entry, `Missing /roots/${i}`); assert.ok(result.draft.graph.nodes[entry.ref]);
        assert.notEqual(entry.ref, label);
        return [label, entry.ref];
    }));
    roots.set(result.draft.id, refs); return result.draft;
}
export function nodeRef(draft: { id: string }, label: string): string {
    const ref = roots.get(draft.id)?.[label];
    assert.ok(ref, `No fixture ref for ${label}`); return ref;
}
