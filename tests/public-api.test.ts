import assert from "node:assert/strict";
import test from "node:test";
import * as api from "../src/index.js";
test("package exposes one engine factory and its schema/storage helpers", async () => {
    assert.deepEqual(Object.keys(api).sort(), ["DefinitionAssemblyError", "GraphEditError", "createMemoryBackend", "createSqliteBackend", "createStagedWrite", "defineDraftType"].sort());
    const engine = api.createStagedWrite({ definitions: [] });
    assert.deepEqual(Object.keys(engine).sort(), ["create", "getDraft", "getBindings", "getArtifact", "preview", "edit", "preflight", "getCheck", "getRun", "getRunInput", "publish", "resume", "close"].sort());
    await engine.close();
});
