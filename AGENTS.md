# Repository development instructions

**Before design or implementation work, read [the project principles](docs/design/000-project-principles.md) and the relevant feature design. Those principles define the project direction; older code, tests and review notes may describe behavior that still needs alignment.**

**If a proposed change conflicts with an established principle, stop the dependent work and discuss the concrete conflict with the project owner. Explain the principle, current/proposed behavior and impact. Change the design only after the owner explicitly agrees. Do not silently change a principle through code, tests, defaults, renaming or a new design document. Unaffected work may continue.**

- Separate established principles, undecided interfaces, target behavior and implemented behavior. Do not turn an open question into an approved design.
- Read `docs/design/018-draft-lifecycle-proposal.md` before changing Draft, reset, publish/resume, storage or locks. The managed default API has one initial Run per Draft, immutable initial intent, fixed-baseline reset and paired lease/store registration. Repeated publish observes; repair uses edit plus resume. Success protects the whole node, including fields ignored by a planner. Remote update after success remains deferred. There is only one public engine factory: `createStagedWrite`. The owner explicitly requested removal of unused prototypes and compatibility layers; do not reintroduce aliases, migrations or deprecated entry points without a concrete requirement.
- Read `docs/design/004-graph-preflight.md` before changing rules or preflight. Preserve the checked Draft preview and concrete messages; the caller/LLM chooses OPs.
- On an agreed principle change, record the decision and update the affected design, examples and tests. Routine implementation choices within the agreed boundaries do not require additional approval.
- This is an independent public library. Do not add employer-specific implementation, business terminology, source paths or private review material to the repository. Reading external references does not authorize copying them into this project.
