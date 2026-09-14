# Repository development instructions

**Before design or implementation work, read [the project principles](docs/design/000-project-principles.md) and the relevant feature design. Those principles define the project direction; older code, tests and review notes may describe behavior that still needs alignment.**

**If a proposed change conflicts with an established principle, stop the dependent work and discuss the concrete conflict with the project owner. Explain the principle, current/proposed behavior and impact. Change the design only after the owner explicitly agrees. Do not silently change a principle through code, tests, defaults, renaming or a new design document. Unaffected work may continue.**

- Separate established principles, undecided interfaces, target behavior and implemented behavior. Do not turn an open question into an approved design.
- Read `docs/design/006-graph-execution.md` before changing publish, resume, Run identity or execution storage. Independent new publish intent and continuation of an existing Run are distinct; the graph engine now supports multiple independent Runs and explicit submission IDs. Keep each Run input isolated from unrelated draft checks. For unfinished execution, edit plus resume may adopt a newly checked repair input, preserving successful facts and historical requests. Editing after all steps succeed remains deferred.
- Read `docs/design/004-graph-preflight.md` before changing rules or preflight. Preserve the checked Draft preview and concrete messages; the caller/LLM chooses OPs.
- On an agreed principle change, record the decision and update the affected design, examples and tests. Routine implementation choices within the agreed boundaries do not require additional approval.
- This is an independent public library. Do not add employer-specific implementation, business terminology, source paths or private review material to the repository. Reading external references does not authorize copying them into this project.
