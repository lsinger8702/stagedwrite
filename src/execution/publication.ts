import { randomUUID } from "node:crypto";
export interface PublishOptions {
    /** Caller-chosen identity for a new write Run. Reusing its certificate observes that Run; no-op publication rejects runId. */
    runId: string;
}
export function publicationId(options: PublishOptions | undefined): string {
    if (options === undefined)
        return randomUUID();
    if (!options || typeof options !== "object" || Object.keys(options).some(k => k !== "runId") ||
        typeof options.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.runId))
        throw new Error("INVALID_PUBLISH_OPTIONS");
    return options.runId;
}
