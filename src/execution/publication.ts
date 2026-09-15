import { randomUUID } from "node:crypto";
export interface PublishOptions {
    /** Optional caller-chosen identity for the Draft's first Run. Subsequent publication observes it. */
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
