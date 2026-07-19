# Mindcraft Plus Reference Architecture Evaluation

Date: 2026-07-18

Current checkout: `eb22db3` (`mindcraft-plus`, cloned from the CE `develop` lineage)
Recommended baseline lineage: Mindcraft CE `stable`, reference commit `42da10d`

## Scope and method

This review covers the current repository and all 12 repositories currently under `_references/`. The reference directory was named `_references/` locally rather than `references/`. Per the corrected inventory, `mindcraft-original-patched` is the locally patched upstream checkout, `mindcraft-ce-stable` is the CE stable checkout, and the duplicate CE develop reference has been removed. It also incorporates the double addendum on profile-owned instruction layers and expandable macro commands backed by an ActionGraph.

The evaluation is based primarily on source paths, not README claims. I inspected entry points, package metadata, planners, command/tool registries, action runners, Mineflayer primitives, movement and combat code, generated-code paths, verifiers, persistence, and tests. Large research repositories were sampled along the execution-critical paths named below rather than read file by file. No dependency installation, provider call, Minecraft server change, or live-world run was performed. Dirty files already present in reference checkouts were treated as local evidence and were not edited.

Important confidence boundary: static inspection can identify lifecycle races and missing contracts, but it cannot prove that a path works against a particular Minecraft server. Block-breaking failures must first distinguish permissions and spawn protection from Mineflayer defects. The known spawn-protection incident is a diagnostic lesson, not evidence that future failures have the same cause.

## 1. Executive summary

### Best base

Mindcraft CE `stable` is the best **baseline lineage**, but the safest practical move is to keep the current checkout and baseline it against stable rather than reset or rewrite it.

The reason is concrete:

- The current `src/agent/action_manager.js` and `src/agent/modes.js` are identical to CE stable.
- The current checkout's differences in the execution area are small and useful: absolute template paths in `src/agent/coder.js` and a corrected weapon sort in `src/agent/library/skills.js`, plus provider/UI changes.
- Returning the branch pointer to stable would not fix interruption, movement cleanup, `newAction` reentry, or combat handoff. Those defects are shared.
- CE stable is smaller and less experimental than the agent-system branch, while preserving the familiar command, profile, provider, and Mineflayer integration that makes incremental hardening feasible.

Therefore “stable as base” should mean: document `42da10d` as the behavioral baseline, keep the current useful forward ports, add characterization tests, and make small reviewed runtime patches. It should not mean a destructive reset.

### Best architectural inspirations

1. **`minecraft-llm-agent-community`** has the strongest authority model: typed action inputs, runtime-owned truth, per-action verification, exact retry constraints, persistent actor work records, dependency-bearing PlanBeads, and candidate/trial/promotion separation for generated actions. Borrow the contracts and boundaries, not its research product framing or current timeout implementation.
2. **`mineflayer-chatgpt` / Minecraft Agent Swarm** has the best operational feedback mechanisms: event priorities, typed skill results, signal-aware static skills, bounded/stall-aware navigation, inventory-delta checks, persistent skill success rates, and trajectory logs. Borrow the measured outcomes and reliability telemetry, not its ad hoc brain or orphanable watchdog promises.
3. **Voyager plus Co-Voyager** supplies the clearest learning and decomposition lessons: retrieve reusable skills, critique failure, promote only successful behavior, and represent prerequisites/subtasks explicitly. Borrow these mechanisms only after replacing generated-code-first execution and LLM-only verification with deterministic primitives and runtime verifiers.

OpenPlayer is a close fourth and the easiest source of small porting ideas: a minimal function-tool loop, serialized intake, persistent todos, and structured mining stop reasons.

### Repositories not suitable as a base

- **CE `r0.1`** is not the advertised ground-up revamp in the checked-out code. Runtime files are essentially stable; differences are primarily documentation, settings, and speech support.
- **CE agent-system** is a useful function-calling sketch but too incomplete and unsafe: in-memory task queues, model-declared completion, broken/fragile call paths, asynchronous initialization races, and unrestricted generated JavaScript paths.
- **`mindcraft-original-patched`** is a diagnostic patch laboratory, not a base. Its combat intent is useful, but force-clearing `executing` while an older promise can still run creates split-brain execution.
- **Minecraft AI** adds plugins, reflection, memory, and social features around the same action core. Its Task plugin is incomplete, and several claimed planning capabilities are prompt-level rather than executable task state.
- **Voyager, Co-Voyager, Odyssey, and MineLand** are research frameworks with valuable mechanisms, but their Python/Node bridges, raw evaluation, process-reset assumptions, older stacks, or benchmark-specific control paths make direct adoption more expensive and less safe than hardening CE.
- **OpenPlayer** is concise and current, but its interrupt signal stops the LLM loop rather than the active Mineflayer tool, and its combat subsystem is disproportionately complex.

### Final recommendation

Build Mindcraft Plus as a layered runtime inside the current CE-derived repository:

```text
Core runtime rules + server rules + profile instruction layers
                         |
Memory/state + task context + user message
                         |
                         v
             PromptAssembler -> generic model backend
                         |
                         v
LLM typed intent / function tool
        |
        v
Macro registry -> persisted ActionGraph
        |
        v
ready node -> deterministic action primitive
        |
        v
ActionRuntime (exclusive leases, AbortSignal, deadline, cleanup, quiescence)
        |
        v
Mineflayer adapter -> observed evidence -> verifier
        |
        +---- success: checkpoint node and unlock dependents
        +---- retryable: checkpoint blocker and bounded retry
        +---- ambiguous: typed AI checkpoint
        +---- unsafe/uncancelled: quarantine; do not start another motion action
```

The model backend—including an OpenClaw/OpenAI-compatible backend—should be generic. Mindcraft Plus owns the Minecraft character, world/server instructions, safety policy, memory/state selection, task context, tool contract, and runtime truth. A backend workspace `AGENTS.md` must not be required to distinguish Surfski from another bot.

The first execution milestone is not `!fullAcquire`. It is proving that at most one motion owner exists, cancellation reaches quiescence, primitives report truthful outcomes, and damage cannot cause pathfinder/PVP/control-state contention. ActionGraph work should begin only after those invariants are testable. Profile instruction loading is an independent configuration seam and can be added earlier, provided it is tested without broad prompt rewrites.

## 2. Current Mindcraft Plus architecture and critical findings

### Macro scale

`src/agent/agent.js` is the coordinator. It constructs `ActionManager`, `Prompter`, `History`, `Coder`, NPC/memory components, the self-prompter, and Mineflayer plugins. Model output is principally text containing one `!command(...)`; `src/agent/commands/index.js` finds and parses that command with regular expressions, then command actions call the shared skill library. `src/agent/modes.js` runs a prioritized collection of reactive modes alongside user/model actions.

Long-horizon work is represented mostly as conversation history, a short natural-language memory summary, `self_prompter` state, and one resumable function. There is no durable task graph, node-level checkpoint, dependency model, typed blocker, or reconnect reconciliation pass.

#### Profile and prompt ownership

Profile composition currently occurs inside `src/models/prompter.js`. It synchronously loads `_default.json`, selects one base profile from `settings.base_profile`, fills missing fields into the individual profile, constructs provider adapters, and writes the merged profile to `bots/<name>/last_profile.json`. The prompt fields in `profiles/defaults/_default.json` are monolithic strings: runtime directions, persona/style, current self-prompt, summarized memory, live stats/inventory, command documentation, examples, and conversation framing are interleaved through placeholders.

This is the correct general area but the wrong granularity for instruction layers:

- `main.js` reads a profile JSON and discards its source-path/config-root identity before the child agent constructs `Prompter`.
- The browser uploads a profile object, so browser-local relative paths are meaningless; referenced instruction files must be server-owned configuration.
- `Prompter.replaceStrings()` is a dynamic placeholder expander, not a configuration loader or precedence model.
- Provider modules receive one completed `systemMessage`; they are already the right generic boundary and should not read persona files themselves.
- `History.memory` is evolving state and is persisted in `bots/<name>/memory.json`. It should not be copied into durable profile instructions or treated as an instruction source.
- `log_all_prompts` can record the fully assembled prompt, but there is no always-on manifest showing which static instruction files contributed to it.

The clean insertion point is a profile/configuration resolver before model construction, followed by a purpose-aware prompt assembler in front of `sendRequest()`. Keep providers unaware of Mindcraft personas. Gradually extract static concerns from the legacy prompt strings behind compatibility placeholders instead of rewriting every prompt at once.

### Micro scale and exact risks

#### Action lifecycle

`src/agent/action_manager.js` uses one Boolean `executing`, one label/function, and one optional resume function.

- `stop()` repeatedly calls `agent.requestInterrupt()` until `executing` becomes false. After ten seconds it kills the process. It has no action id, generation, queue, resource lease, or proof that plugin work stopped.
- `_executeAction()` interrupts the current action, then starts the new promise. A fulfilled promise is reported as `success: true` without a postcondition.
- In the catch path, `executing` is set false before `await this.stop()`. `stop()` therefore returns immediately and cannot perform meaningful wait/cleanup.
- The error is converted to a string before `err.stack` is appended, losing the stack in the returned message.
- `timedout` is never reset at action start, so later result summaries can inherit stale timeout state.
- Fast-loop detection is based on start timestamps, not semantic action identity or an admission policy.

`src/agent/agent.js#requestInterrupt` calls `stopDigging`, `collectBlock.cancelTask`, `pathfinder.stop`, and `pvp.stop`, but does not own a complete, ordered cleanup protocol for goals, control states, active item use, open windows, plugin listeners, or post-stop settling. Death invokes some lifecycle methods without awaiting them. Disconnect exits the process instead of reconciling a durable task checkpoint.

#### Mode and combat handoff

`src/agent/modes.js` chooses modes based partly on active action label strings. Modes call the same `ActionManager` and can interrupt ordinary actions.

- `cowardice` calls `skills.avoidEnemies`.
- `src/agent/library/skills.js#avoidEnemies` uses an inverted pathfinder goal but can call `attackEntity(..., false)` when the hostile is close. That mixes flee and combat authority.
- `self_defense` calls `skills.defendSelf`, which combines pathfinder following/inversion and PVP while the bot may be under damage or knockback.
- Multiple controllers can therefore assert movement near the same damage event, matching the observed `invalid_player_movement` chain.
- `unstuck` and `self_preservation` are valuable safety policies, but they use interruption rather than a single danger arbiter and motion-owner handoff.

The temporary design lesson is sound: cowardice should only create an evasion intent; self-defense should only fight within an already-close engagement envelope; neither should chase while damage/knockback is unsettled. This must be enforced by the runtime, not just prompts or scattered cleanup calls.

#### Primitive truthfulness

The skill library is large and practical, but Boolean returns and logs frequently stand in for verification.

- `collectBlock` can return success after collecting some blocks rather than the requested count.
- `goToNearestBlock` and `goToNearestEntity` can return true even if the nested position move returned false.
- placement, crafting, and smelting inspect some state but do not share a uniform before/after verifier contract.
- furnace/window cleanup is not consistently in `finally` blocks.
- global helpers such as the door interval make resource ownership hard to attribute.

The right fix is not to convert the whole file at once. Introduce one structured result envelope and migrate primitives one by one behind compatibility adapters.

#### Generated code

`src/agent/coder.js` asks for a code block, stages it, lints it, and evaluates it in an SES `Compartment` with `skills`, `world`, `log`, and `Vec3`.

Risks:

- `src/agent/library/lockdown.js` exports a function named `lockdown` and calls `lockdown({...})` inside itself. That call resolves recursively to the wrapper; because `lockeddown` is already true, it returns. The imported SES global lockdown is therefore apparently never invoked.
- `_stageCode()` uses string replacement and injects interruption checks after every `;\n`; the code itself notes that callbacks may break.
- full generated source is printed and returned into history.
- the lint stage is useful, but generation has no AST capability contract, per-call resource budget, helper-call audit, independent verifier, or promotion lifecycle.
- `src/models/prompter.js#promptCoding` returns a fake `//no response` code block on reentry and does not reset `awaiting_coding` in a `finally` block. An API exception can leave it permanently busy.

Generated code should remain disabled by default until the lockdown bug is tested. Longer term, generated behavior should be a bounded micro-action candidate using a fixed helper API, executed out of process, verified, and discarded or promoted deliberately.

#### Command and persistence surfaces

`src/agent/commands/index.js` supports only a narrow quoted-scalar syntax. `blacklistCommands()` deletes from the map but `delete commandList.find(...)` does not remove the list element. Command strings are acceptable as a human compatibility layer, but the internal API should be typed objects/function calls.

`src/agent/history.js`, `src/agent/memory_bank.js`, and `src/agent/self_prompter.js` preserve useful conversational state but not executable continuity. A saved natural-language goal is not enough to determine which subtask completed, which verifier passed, which resources are reserved, or whether the last action is safe to resume.

### Baseline conclusion

The current code is a reasonable integration shell and a poor concurrency authority. Preserve profiles, providers, commands, Mineflayer setup, and the deterministic skills that work. Replace lifecycle ownership and result semantics incrementally.

## 3. Repository-by-repository analysis

### 3.1 `mindcraft-ce-stable`

**What it is.** The intended stable CE snapshot at `42da10d`. It is the closest match to Mindcraft Plus's desired operational base.

**Macro architecture.** Agent coordinator + command-string selection + reactive modes + optional generated code + history/self-prompt memory. There is no task graph or durable scheduler.

**Micro architecture.** The action manager, modes, and most skill implementations are the same as the current runtime. Movement relies on `mineflayer-pathfinder`; gathering uses `mineflayer-collectblock`; combat uses `mineflayer-pvp`; interruption is a shared Boolean/code flag plus plugin stop calls.

**Most valuable ideas.** Familiar operational surface, broad deterministic skill library, provider abstraction, human-readable commands, and relatively small delta from the current repository.

**Risks.** The known action race, dirty motion after interruption, mixed flee/combat behavior, optimistic success, unsafe codegen boundary, and no structured resume.

**Study.** `src/agent/action_manager.js`, `src/agent/agent.js`, `src/agent/modes.js`, `src/agent/library/skills.js`, `src/agent/coder.js`, `src/models/prompter.js`.

**Decision.** **Use as baseline lineage; do not copy its scheduler unchanged.**

### 3.2 `mindcraft-ce-r01`

**What it is.** A branch advertised as a complete revamp, checked out at `2b2628e`.

**Macro/micro architecture.** In the inspected checkout, runtime architecture is effectively CE stable. The material differences are documentation, settings, profiles, and speech-related code, not a replacement action/task runtime.

**Most valuable ideas.** Documentation organization and possibly speech/UI changes, if independently desired.

**Risks.** Branch naming and README claims can create false confidence. It does not solve the architectural problems in scope.

**Study.** `README.md`, `docs/`, `src/agent/speak.js`; compare, rather than assume, `src/agent/action_manager.js` and `src/agent/modes.js`.

**Decision.** **Ignore for runtime architecture; cherry-pick only isolated presentation work after review.**

### 3.3 `mindcraft-ce-agents`

**What it is.** Experimental CE agent-system/function-calling branch at `9e06f94`.

**Macro architecture.** A `BrainAgent` routes roleplay/task work; `TaskAgent` loops through model tool calls; a simple `Goals` object and `MessageQueue` hold in-memory work. Tool definitions are classes derived from `BaseTool`. RAG adds a LanceDB-backed wiki lookup surface.

**Micro architecture.** Tool schemas are converted to provider function declarations and invoked through the legacy skill layer. Active task cancellation is mainly checked between model/tool steps. The current tool can continue because cancellation is not a runtime-wide motion protocol. Completion is ultimately model-reported. The RAG skills/memory portions are incomplete.

Important code risks include asynchronous tool initialization at module load, fragile forced-command argument flow, an in-memory-only queue, and generated-code agents that use `new Function` or write/import JavaScript with broad agent access.

**Most valuable ideas.** Native function tools, per-tool schemas/classes, a brain/task separation, and deterministic crafting-plan queries.

**Risks.** Experimental integration defects, no durable task graph, no deterministic success boundary, cancellation between rather than through tools, unsafe code execution, and incomplete RAG.

**Study.** `src/agent/commands/base_tool.js`, `src/agent/commands/index.js`, `src/agent/agents/brain.js`, `src/agent/agents/task.js`, `src/agent/agents/executor.js`, `src/agent/agents/code.js`, `src/agent/goals/goals.js`, `src/agent/message_queue.js`, `src/agent/rag/`.

**Decision.** **Borrow the tool envelope, avoid the branch as a base.**

### 3.4 `mindcraft-original-patched`

**What it is.** Upstream Mindcraft at `5f3acc8` with substantial uncommitted local experiments for the observed action/combat problems.

**Macro architecture.** Same broad upstream command/mode/codegen architecture. Local patches add duplicate-action refusal, motion cleanup, compact codegen rules, and revised cowardice/self-defense behavior.

**Micro architecture.** The patches correctly identify the need to clear pathfinder, PVP, digging, collecting, and controls; they also make cowardice flee-only and self-defense close-only. However, the patched `ActionManager` can force `executing=false` after a short wait while the prior promise is still alive. That permits a new action to start against orphaned work.

**Most valuable ideas.** The behavioral intent and the concrete list of subsystems that need cleanup. Suppressing full code echo and refusing duplicate `newAction` are appropriate near-term directions.

**Risks.** Split-brain force clear, cleanup spread across callers, backups/configuration mixed into the dirty checkout, and no action generation/lease to protect finalization.

**Study.** Dirty diffs in `src/agent/action_manager.js`, `src/agent/modes.js`, `src/agent/library/skills.js`, `src/agent/coder.js`, and `src/agent/connection_handler.js`.

**Decision.** **Borrow intent and test cases; do not copy the force-clear implementation.**

### 3.5 `minecraft-ai`

**What it is.** A Mindcraft-derived social/embodied-character platform at `02de4ad` with optional plugins, memory/reflection, profiles, and benchmark-oriented features.

**Macro architecture.** It extends the familiar agent with a `PluginManager`, a richer memory bank, self-driven reflection/planning, and plugins for tasks, blueprints, local/cloud knowledge, damage response, and social behaviors.

**Micro architecture.** Core actions still pass through the same Boolean `ActionManager` pattern. The Task plugin's `Task.execute()` is empty; task loading checks the wrong property in one path and `newTask()` mostly expands a prompt then calls `!goal`. Self-driven thinking stores prose/todos rather than verified executable state. Damage response provides context but does not arbitrate movement controllers.

**Most valuable ideas.** Optional plugin boundaries, persisted fact memory, explicit damage-source context, and blueprint data as a bounded local action input.

**Risks.** Claimed planning exceeds implementation, plugin init is asynchronous, prompt-generated todos are not task authority, core interruption is unchanged, and dependency patches include noisy whole-package mode changes.

**Study.** `src/agent/plugin.js`, `src/agent/memory.js`, `src/plugins/SelfDrivenThinking/main.js`, `src/plugins/Task/main.js`, `src/plugins/PlayerDamageResponse/main.js`, `src/plugins/BuildWithBlueprint/`.

**Decision.** **Borrow isolated plugin/memory ideas; avoid as runtime base.**

### 3.6 `mineflayer-chatgpt` (Minecraft Agent Swarm)

**What it is.** A current TypeScript multi-bot autonomy/streaming project at `a886e68`, combining hand-authored skills, imported Voyager skills, runtime-generated skills, role specialization, shared stash, and local-model decisions.

**Macro architecture.** `BotBrain` owns a prioritized event queue for strategic, reactive, chat, and critic events. Per-bot JSON memory tracks structures, deaths, ores, lessons, and skill attempts. A deterministic curriculum emits the next tech milestone. Team state is shared through a bulletin and stash. The critic can suggest the next action or replan. `BotRoleConfig` separates per-bot name, personality, role, allowed actions/skills, and priorities, and focused prompt builders accept that role context.

**Micro architecture.** `Skill` has a typed `SkillResult`, material estimator, `AbortSignal`, and progress callback. Static skills commonly poll the signal. `safeGoto` adds timeout/stall detection. Gathering and crafting often measure inventory deltas. Skill reliability aggregates results across bots and retires consistently broken skills while allowing occasional parole attempts.

The central weakness is lifecycle truth: `executor.ts` and `actions.ts` race a skill/action against a watchdog, stop only pathfinder/digging, and return while the losing promise may still run. Dynamic skills run in `vm.createContext`, which its own comment correctly says is not a security boundary; `safeRequire` permits broad trusted modules, and async timeout does not terminate code. Reactive events are serialized but generally do not interrupt a running skill, except separate rescue timers can manipulate controls.

**Most valuable ideas.** Typed skill contracts, progress events, inventory-delta evidence, stall-aware navigation, failure classification that separates preconditions from implementation defects, skill reliability statistics, event priority/deduplication, trajectory JSONL, and typed per-bot role context. Its role configuration is a useful profile-owned-persona precedent, although Mindcraft Plus should replace hardcoded multiline fields with layered files and a manifest.

**Risks.** Orphaned promises after watchdogs, concurrent rescue/control activity, ad hoc exception-based failure classification, huge monolithic action file, generated-code host access, critic truth derived from result strings, and no exact macro checkpoint.

**Study.** `src/bot/brain.ts`, `src/bot/actions.ts`, `src/bot/navigation.ts`, `src/skills/types.ts`, `src/skills/executor.ts`, `src/skills/materials.ts`, `src/skills/reliability.ts`, `src/skills/dynamic-loader.ts`, `src/bot/memory.ts`, `src/bot/trajectory.ts`.

**Decision.** **Strong inspiration; port result, telemetry, and navigation patterns selectively.**

### 3.7 `openplayer`

**What it is.** A compact OpenClaw-inspired CommonJS Mineflayer agent at `a950e3d` with 40+ function tools, vision, transcript memory, todos, reconnect, and a minimal model/tool loop.

**Macro architecture.** `CommandQueue` serializes event batches; `Agent` repeatedly asks the model for tool calls until an explicit final tool; `SessionManager` persists JSONL, long-term Markdown memory, and todo state. `SessionManager` also loads an external `SOUL.md`, tools, wiki, memory, and todos into its system prompt, caches the static portion, watches files, and logs a short SHA-256 prompt hash.

**Micro architecture.** Tool modules directly wrap Mineflayer. `go_to` bounds movement and clears the pathfinder goal. The mining orchestrator performs tool preflight and returns structured counts, unreachable totals, and `stopReason`. Crafting computes recipe repetitions and reports post-inventory count. `flee_from` is separate from attack.

Interruption is incomplete: the queue's `AbortController` is passed to the LLM request, not the tool registry, so an active Mineflayer tool does not observe it. `_drain()` checks an undefined `_interrupted` property. Mining's per-block `Promise.race` timeout does not cancel the underlying collect task. The very large `defense_mode.js` monkey-patches PVP and owns many timers/listeners, making cleanup and reasoning difficult.

**Most valuable ideas.** Minimal function-tool loop, serialized intake, explicit finalization, persistent todos, structured mining stop reasons, bounded preflight, a separate flee tool, and an editable external persona file with cache invalidation and a logged digest. For Mindcraft Plus, use the external-file/digest idea but not OpenPlayer's silent default persona fallback or its conflation of durable instructions, tools, wiki, memory, and todos into one nominally static system block.

**Risks.** Cancellation stops reasoning rather than physical work, schemas lack a strong runtime validator, optimistic string outcomes, no task dependencies/verifiers, and over-engineered combat.

**Study.** `src/agent.js`, `src/queue.js`, `src/session.js`, `src/tools/registry.js`, `src/tools/mining_orchestrator.js`, `src/tools/go_to.js`, `src/tools/craft.js`, `src/tools/flee_from.js`, `src/tools/defense_mode.js`.

**Decision.** **Borrow small tool-loop and result-shape ideas; avoid its cancellation/combat implementation.**

### 3.8 `minecraft-llm-agent-community`

**What it is.** A large TypeScript/Bun research runtime at `19fc3206` for evidence-rich multi-actor Minecraft experiments. Its product goal differs from Mindcraft Plus, but its runtime authority boundaries are highly relevant.

**Macro architecture.** Actor identity, long-lived goals, evidence, relationships, and PlanBeads are persisted in an actor workspace. An Actor Turn provider sees typed current state, evidence cards, and schema-backed Action Cards, then selects exactly one function tool or requests generated action authoring. Runtime gates validate schemas, permissions, retry constraints, source contracts, execution, and verifiers. PlanBeads are dependency-bearing work context, explicitly not executable authority.

**Micro architecture.** `actionRunner.ts` supplies per-tool timeouts and an `AbortSignal`. Primitives such as `mineBlock`, `collectLogs`, `craftItem`, `consumeItem`, and `placeBlock` return measured state deltas. Exact repeated blockers can become retry constraints keyed by normalized structured args. Generated candidates have helper allowlists, schemas, trial verifiers, evidence, and promotion records.

The code still has gaps relevant to this fork:

- `runAction()` returns the timeout artifact as soon as the race wins; it does not await cleanup/quiescence.
- several primitives stop pathfinder/digging/controls but do not cover PVP, collectBlock, windows, or a universal motion lease.
- generated TypeScript is regex-screened, written, and dynamically imported into the host process. Regex source checks and a Proxy helper allowlist are not an isolation boundary.
- combat/flee action skills are mostly planned/missing primitives rather than a proven survival runtime.
- the main social-cycle orchestrator is large and the repository's research-specific schemas would be excessive to transplant wholesale.

**Most valuable ideas.** Provider/runtime authority separation, structured action parameters, evidence-bearing result contracts, exact retry gates, candidate→trial→promotion, dependency validation/cycle rejection, optimistic-concurrency checkpoint versions, append-oriented evidence, and explicit separation of durable work context from execution authority.

**Risks.** High conceptual/implementation weight, research-specific product assumptions, host-process generated code, same timeout-orphan risk, and incomplete combat.

**Study.** `probe/src/runtime/actions/actionRunner.ts`, `probe/src/runtime/goals/actorEpisode/`, `probe/src/runtime/retryConstraints.ts`, `probe/src/runtime/goals/planBeads/`, `probe/src/runtime/actorWorkspaceStore.ts`, `probe/src/tools/`, `probe/src/skills/generated/`, `probe/src/skills/lifecycle/promotion.ts`, `probe/src/generatedActionSkills/directExecutor.ts`.

**Decision.** **Primary contract inspiration; adapt a much smaller subset.**

### 3.9 `voyager`

**What it is.** The original open-ended lifelong-learning research agent at `55e45a8`.

**Macro architecture.** Separate curriculum, action, critic, and skill-manager agents. The curriculum proposes tasks; the action model produces JavaScript; the environment returns observations/errors; the critic decides success; successful code is embedded and stored for retrieval.

**Micro architecture.** Generated programs and the skill library are evaluated in the Mineflayer environment. Skills are parsed for basic shape and refined through execution feedback. Checkpoints persist skills, completed/failed tasks, and event history, but not exact in-flight physical action state.

**Most valuable ideas.** Successful-only skill promotion, retrieval of a compact relevant subset, iterative error/critic feedback, curriculum separation, and durable skill metadata.

**Risks.** Generated code is the primary action language, environment execution uses eval, success is largely LLM-critic-owned, cancellation often means process reset, and the stack is old for direct adoption.

**Study.** `voyager/voyager.py`, `voyager/agents/action.py`, `voyager/agents/critic.py`, `voyager/agents/curriculum.py`, `voyager/agents/skill.py`, `voyager/env/mineflayer/index.js`.

**Decision.** **Borrow the learning loop, never the generated-code-first authority model.**

### 3.10 `co-voyager`

**What it is.** A Voyager fork at `aeb04dd` focused on cooperative task decomposition and skill reuse.

**Macro architecture.** A task manager asks the LLM for JSON subtasks; `Task`/`SubTask` track blocked, ready, in-progress, and completed states; material/tool prerequisites and plan criticism influence replanning. A Pair Manager maps exact tasks to learned behaviors.

**Micro architecture.** Execution ultimately inherits Voyager-style generated code and Mineflayer bridge behavior. Subtask readiness/material computation is only partially connected to actual post-action inventory and dependency state.

**Most valuable ideas.** Explicit subtask status, material/tool prerequisites, persisted task→behavior association, decomposition validation, and a task-level critic.

**Risks.** Dependency handling is incomplete, some readiness/type comparisons are defective, “parallel” multi-agent execution is more framework intention than robust scheduler, completion is not grounded in a uniform verifier, and code execution remains unsafe.

**Study.** `voyager/classes/task.py`, `voyager/agents/task_manager.py`, `voyager/agents/task_critic.py`, `voyager/agents/pairs_manager.py`, `voyager/agents/skill_manager.py`, `voyager/voyager.py`.

**Decision.** **Borrow the subtask schema vocabulary; reimplement rather than port.**

### 3.11 `odyssey`

**What it is.** A Voyager-derived open-world skill-library research suite at `260303c`, with 40 primitives, 183 compositional skills, planning benchmarks, model tooling, and multi-agent experiments.

**Macro architecture.** Planner, action, critic, comment, and skill agents choose/retrieve compositional skills and track completed/failed tasks. The comprehensive library supplies a large catalog of item acquisition and domain behaviors.

**Micro architecture.** Python orchestrates a Node Mineflayer environment and executable JavaScript skills. Some benchmark success checks are deterministic inventory predicates; other success decisions are LLM critics. Resume restores checkpointed planner/skill state rather than in-flight controller state.

**Most valuable ideas.** Broad compositional macro catalog, retrieval instead of always generating, explicit acquisition recipes, skill descriptions/metadata, and deterministic inventory checks for known task classes.

**Risks.** Large research stack, brittle prompt/JSON parsing, eval-based execution, domain-specific planner hardcoding, mixed verifier authority, and no strong cancellation/quiescence layer.

**Study.** `Odyssey/odyssey/agents/planner.py`, `actor.py`, `critic.py`, `skill.py`, `Odyssey/odyssey/odyssey.py`, `Odyssey/odyssey/control_primitives/`, `MC-Comprehensive-Skill-Library/skill/`, `MC-Comprehensive-Skill-Library/json/`.

**Decision.** **Mine for macro definitions and verifier fixtures; do not port the framework.**

### 3.12 `mineland`

**What it is.** A large-scale multi-agent simulator/benchmark at `f72d3f2`, plus the Alex multitasking agent.

**Macro architecture.** A Python simulator coordinates many bots through a Node bridge, step boundaries, observations, events, and high-/low-level actions. Alex separates self-check, critic, planning/memory, and action. Its action protocol distinguishes `NEW` from `RESUME`.

**Micro architecture.** Per-bot code state and `AbortController`s provide an observable execution envelope. Interrupt stops pathfinder, clears controls, and stops digging. High-level code still runs through eval, and interrupt can mark a bot ready before every plugin promise is known to have ended.

**Most valuable ideas.** Explicit NEW versus RESUME semantics, turn/step boundaries, code status/error/event envelopes, deterministic benchmark success wrappers, and multi-bot observation infrastructure.

**Risks.** Simulator rather than production agent runtime, raw code execution, incomplete plugin cleanup, action-ready split brain, heavyweight server assumptions, and task-specific evaluation.

**Study.** `mineland/sim/bridge.py`, `mineland/sim/data/action.py`, `mineland/sim/mineflayer/bot_manager.js`, `mineland/alex/`, and task wrappers under `mineland/sim/`.

**Decision.** **Borrow protocol semantics and test harness ideas; not a base.**

### Cross-reference answers for command expansion

- **Existing graph/tree equivalents:** the community runtime's PlanBeads are the strongest dependency graph, but deliberately remain work context rather than executable authority. Co-Voyager has the clearest explicit subtask states and prerequisites. Voyager has a curriculum plus promoted skill library; Odyssey has the broadest compositional macro catalog; MineLand exposes useful `NEW`/`RESUME` protocol states. None supplies a production-ready, cancellation-safe ActionGraph that can be transplanted.
- **Best high-level/low-level separation:** `minecraft-llm-agent-community`. Its provider proposes a schema-valid action while runtime gates own permissions, execution, evidence, and verification. Mindcraft Plus should adopt that authority split with far fewer schemas and product concepts.
- **Best verification-after-action:** the community runtime has the strongest general contract; the swarm has the most immediately portable operational checks, especially inventory deltas and stall/progress telemetry; OpenPlayer's mining `stopReason` is a useful narrow result shape. No reference should be trusted where an LLM critic is the only success authority.
- **Best resumability/failure recovery:** the community runtime has the best durable work/evidence model; Voyager has the most mature research checkpoint loop; MineLand names `RESUME` explicitly. None reconciles a crashed in-flight Mineflayer mutation robustly. Mindcraft Plus must add `interrupted_unknown`, cleanup, observation, idempotent verification, and only then resume.
- **Safest generated-code boundary:** none is safe enough. The community runtime is the least unsafe conceptually because it separates candidate, trial, verifier, evidence, and promotion, but it still dynamically imports screened code in the host. The required Mindcraft Plus boundary is a killable external process with a capability-limited helper protocol and independent verifier.
- **Best action abstraction to port:** use the community runtime's structured action/evidence contract as the design model and the swarm's `SkillResult`/`AbortSignal`/progress patterns as the implementation-sized starting point. Do not port either scheduler wholesale.

## 4. Comparative matrix

Legend: **H** strong, **M** usable/mixed, **L** weak, **N/A** outside the repository's goal. Scores judge suitability for Mindcraft Plus, not research merit.

| Repository | Stability | Clarity | Mineflayer integration | Action/task architecture | Macro planning | Generated-code safety |
|---|---:|---:|---:|---:|---:|---:|
| Current Mindcraft Plus | M | M | H | L | L | L |
| CE stable | M+ | M | H | L | L | L |
| CE r0.1 | M | M | H | L | L | L |
| CE agents | L | M | M | M- | M- | L |
| Original patched | L | M | H | L | L | L |
| Minecraft AI | M- | M- | H | L | M- | L |
| Minecraft Agent Swarm | M | M | H | M | M | L |
| OpenPlayer | M | H | H | M- | L+ | N/A (no primary codegen) |
| Community runtime | M- | M | H | H | H | M- |
| Voyager | M research | M | M | M | H | L |
| Co-Voyager | L | M- | M | M | H- | L |
| Odyssey | M research | L+ | M | M | H | L |
| MineLand | M research | M- | H simulator | M | M | L |

| Repository | Combat | Movement | Interruption | Verification / resume | Ease of porting |
|---|---:|---:|---:|---:|---:|
| Current Mindcraft Plus | L | M | L | L | H |
| CE stable | L | M | L | L | H |
| CE r0.1 | L | M | L | L | H but little value |
| CE agents | L | M | L | L | M |
| Original patched | M intent / L lifecycle | M | L | L | M |
| Minecraft AI | L | M | L | L+ prose memory | M |
| Minecraft Agent Swarm | M | M+ | M- | M | M |
| OpenPlayer | M- | M | L | M- | H for small ideas |
| Community runtime | L/planned | M+ | M- | H | M- |
| Voyager | M- | M- | L | M critic/checkpoint | L |
| Co-Voyager | M- | M- | L | M- | L |
| Odyssey | M | M- | L | M | L |
| MineLand | L/M benchmark | M | M- | M | L |

No reference earns a high interruption score. That is the central architectural conclusion: Mindcraft Plus needs its own quiescent action runtime rather than selecting an existing scheduler wholesale.

## 5. Design lessons for Mindcraft Plus

1. **One physical owner, many intent producers.** User commands, LLM actions, modes, damage handlers, unstuck, and self-prompting may all propose work. Only one runtime authority may own motion/combat/digging/window resources at a time.
2. **Cancellation is a protocol, not a Boolean.** Signal the action, invoke subsystem-specific cancellation, await the action promise and resource quiescence, then transition state. A timeout that merely wins `Promise.race` does not cancel the loser.
3. **Never declare idle while old work can mutate the bot.** If an operation will not quiesce, quarantine the bot and reconnect/terminate as an explicit recovery boundary. Do not start a successor action.
4. **Separate safety policy from controllers.** A danger arbiter chooses evade, close-defense, recover/eat, or hold. Pathfinder, PVP, and manual control implementations are subordinate executors, not competing modes.
5. **Damage creates a movement-settle window.** Stop chase/PVP/pathfinder, clear controls, wait for a small number of physics ticks or stable velocity/position evidence, then admit only the chosen bounded response.
6. **Cowardice never attacks. Self-defense never chases by default.** Escalation from evade to fight must be an explicit policy transition with distance, health, equipment, and cooldown evidence.
7. **Results are observations, not prose.** Every primitive should return status, reason code, retryability, before/after evidence, and cleanup state. Logs are diagnostic context, not success.
8. **Verification is action-specific.** Movement verifies distance/progress; collecting verifies inventory delta and target count; crafting verifies output delta; placement verifies world block plus inventory delta; combat verifies target gone/disengaged and bot state; smelting verifies output/container state.
9. **Absence claims need scan bounds.** “No diamond found” must include loaded-chunk/radius/Y bounds and nearby candidates. Spawn protection/permissions must be a preflight category distinct from protocol and path failures.
10. **Macro work and execution authority are different.** A graph node may say “acquire iron,” but only a validated action primitive with structured args can touch Mineflayer.
11. **Persist at verified boundaries.** Checkpoint after node admission, action completion/failure, verifier result, dependency unlock, and safety interruption—not on every control tick.
12. **Resume means reconcile, then continue.** After reconnect/crash, observe inventory, position, dimension, health, open work, and possibly placed blocks. Re-run idempotent node verifiers before choosing the next ready node.
13. **AI checkpoints are typed ambiguity handlers.** Give the model a bounded snapshot and explicit choices. It may select/repair a graph transition; it may not assert that physical work succeeded.
14. **Generated code is capability fallback, not the normal planner.** Prefer known primitives and macros. Generated micro-actions must be short, helper-limited, externally isolated, signal-aware, timed, logged by helper call, and independently verified.
15. **Learn from failure classes, not strings.** The swarm's reliability tracking is useful, but Mindcraft Plus should record enum reason codes such as `precondition_missing`, `permission_denied`, `unreachable`, `cancelled`, `no_progress`, and `implementation_error` rather than infer categories from English.
16. **Keep model/provider abstraction outside the runtime.** Providers produce the same typed intent/tool call. Model quirks cannot change action lifecycle or verification semantics.
17. **Retain human command compatibility at the edge.** Parse `!fullAcquire("diamond", 64)` into the same validated macro request used by function calling. Do not make string parsing the internal task representation.
18. **Small tests protect ownership invariants; live probes validate Mineflayer behavior.** Both are needed. Mock-only tests cannot prove plugin cancellation, and live-only testing makes race regressions expensive to isolate.
19. **Instructions are configuration; memory is state.** Persona, style, server rules, and durable behavior preferences are versioned static inputs. Locations, player facts, outcomes, and current work evolve independently and must retain provenance/confidence rather than becoming higher-authority instructions.
20. **Mindcraft owns the character; the backend owns inference.** OpenClaw, OpenAI-compatible endpoints, and other providers receive an assembled request. They should not require bot-specific workspaces, `AGENTS.md` files, or finetuning to distinguish characters.
21. **Prompt composition must be inspectable.** Resolve instruction layers once, in declared order, with canonical paths, hashes, sizes, purpose, and explicit missing-file policy. Log the manifest even when full prompt logging is disabled.
22. **Prompt priority is not an enforcement boundary.** Core safety/runtime rules are non-overridable in configuration and are also enforced by schemas, registries, resource leases, verifiers, and safety arbitration. A later persona file cannot grant a blocked action or weaken cancellation.

## 6. Recommended Mindcraft Plus architecture

### 6.1 Layer boundaries

Mindcraft Plus needs two related but separate planes. The prompt/configuration plane turns durable bot configuration plus current state into a model request. The execution plane turns only validated typed intent into world mutations.

```text
server-owned config root
  prompts/runtime/*.md + server rules + agents/*.md
                         |
                         v
ProfileResolver -> InstructionLoader -> PromptAssembler
                                      + memory/state snapshot
                                      + task/action snapshot
                                      + user/chat turn
                         |
                         v
             generic BackendAdapter (OpenClaw/provider)
                         |
                         v
                    typed intent
```

```text
Chat command / function call / self prompt / safety observation
                         |
                         v
                  IntentGateway
        validates typed requests and admission source
                         |
             +-----------+-----------+
             |                       |
             v                       v
       MacroRegistry              Direct primitive
             |
             v
   ActionGraphStore + Scheduler
   dependencies, checkpoints, retry policy
             |
             v
         ActionRuntime
   queue, exclusive leases, cancellation, deadline
             |
             v
       PrimitiveRegistry
   deterministic Mineflayer adapters
             |
             v
      Evidence + VerifierRegistry
             |
      +------+------+------+
      |             |      |
   success       blocker  ambiguous
      |             |      |
 checkpoint      retry/    AI checkpoint
 and unlock      replan    (no physical truth)
```

Keep `Agent`, existing commands, modes, and skills initially. Add adapters so callers can migrate without a flag-day rewrite.

### 6.2 Profile-side instructions and prompt assembly

Accept the requested shorthand in profiles:

```json
{
  "name": "Surfski",
  "instruction_layers": [
    "./agents/default.md",
    "./agents/survival.md",
    "./agents/surfski.md"
  ]
}
```

Normalize each string internally to a record such as `{ id, path, canonicalPath, sha256, bytes, required, purposes }`. Supporting object entries later is useful for purpose scoping, but the initial public schema should remain the simple ordered array. Use a server-owned canonical configuration root, defaulting to the Mindcraft Plus project/config root, so the same path means the same thing for CLI and browser-created agents. Do not resolve paths relative to a browser upload, accept remote URLs, or allow a profile to choose the root. Canonicalize paths, reject symlink/path traversal outside approved roots, require UTF-8 Markdown, bound file count/bytes, and reject accidental duplicate canonical files.

Default to `instruction_missing_policy: "error"`. A development-only `"warn"` policy may continue with an unmistakable structured warning, but silent ignore and silent fallback are unacceptable. Loading should emit, in order, the profile name, logical path, canonical relative path, SHA-256 digest, byte count, and purpose. Full contents belong only in explicitly enabled prompt logs; the manifest should always be available in startup diagnostics and `bots/<name>/last_profile.json` without turning the file into memory.

Recommended ownership and insertion points:

- add `src/config/profile_resolver.js` to own `_default` -> base profile -> individual profile merging instead of mutating the caller's profile inside `Prompter`;
- add `src/config/instruction_loader.js` for root confinement, loading, validation, digesting, and manifest construction;
- call the resolver through the common `Mindcraft.createAgent()` path so CLI and MindServer/UI agents receive the same semantics, then revalidate/load in the agent process before model construction; do not expose resolved file contents through the public `get-settings` response;
- add `src/models/prompt_assembler.js` to compose named static and dynamic sections and return both `systemMessage` and a trace manifest;
- leave `src/models/gpt.js`, `claude.js`, and other adapters unchanged except for receiving the final assembled `systemMessage`;
- retain the current prompt fields/placeholder expansion as a compatibility layer while static runtime/persona text is extracted incrementally.

Recommended repository shape:

```text
agents/
  default.md
  survival.md
  creative-builder.md
  surfski.md
prompts/runtime/
  conversation.md
  planning.md
  ai-checkpoint.md
  generated-micro-action.md
src/config/
  profile_resolver.js
  instruction_loader.js
src/models/
  prompt_assembler.js
```

The logical conversation/planning stack is:

1. code-owned core Mindcraft Plus runtime/tool rules;
2. server/world rules selected by trusted server configuration;
3. ordered profile instruction layers;
4. current memory and observed state, labeled as data with provenance/time;
5. current task, ActionGraph, action, blockers, and allowed choices;
6. the user/chat message as the user turn, not concatenated into static instructions.

Composition must be purpose-aware. Conversation, planning, and AI-checkpoint requests normally receive profile identity/style. Memory summarization receives its narrow summarization contract and state, not persona instructions that can distort retention. Generated micro-action authoring receives the capability contract, bounded local objective, schema, and evidence, not character prose. Vision analysis receives only relevant runtime/world/profile layers. The assembler should make these choices explicit in its trace rather than relying on each call site to concatenate strings.

Precedence is not permission. Later character layers may refine voice and preferences, but cannot override the code-owned action allowlist, server policy, safety modes, primitive schemas, or runtime invariants. This keeps OpenClaw a generic backend and makes bot changes a Mindcraft profile/configuration change, not a backend workspace or finetuning operation.

### 6.3 `ActionRuntime` contract

Replace the Boolean action manager over several patches with an explicit state machine:

```js
ActionRequest = {
  id, kind, label, owner, priority, concurrencyKey,
  parentNodeId, input, timeoutMs, interruptPolicy
}

ActionState =
  queued | starting | running | cancelling |
  succeeded | failed | cancelled | timed_out | quarantined

ActionResult = {
  actionId, status, reasonCode, message, retryable,
  startedAt, endedAt, evidence, cleanup
}
```

Rules:

- one active action generation per bot;
- one exclusive `motion` lease initially; later split only when evidence shows safe concurrency;
- a finalizer may mutate runtime state only if its action id/generation still owns the slot;
- duplicate `action:newAction` is rejected or coalesced, not used to interrupt itself;
- priority safety actions request cancellation, but start only after quiescence;
- a timeout transitions to `cancelling`, not directly to `timed_out`/idle;
- a non-quiescent action becomes `quarantined`; reconnect or process termination is explicit and no successor is admitted.

### 6.4 Cancellation and motion cleanup

Create one idempotent `MotionController`/cleanup adapter. Suggested initial shutdown order:

1. abort the action signal and mark `cancelling`;
2. cancel collectBlock and await/observe task settlement where the plugin permits it;
3. stop PVP/custom combat and clear target;
4. clear dynamic pathfinder goal and stop pathfinder;
5. stop digging and await `diggingCompleted`/`diggingAborted` or a bounded settle check;
6. deactivate held item/use state;
7. close windows owned by the action in a `finally` path;
8. clear all control states;
9. wait a bounded number of physics ticks;
10. verify no active pathfinder goal, combat target, target dig block, asserted controls, or owned window/listener remains.

Return a structured cleanup report. “Best effort” exceptions should be recorded per subsystem. The cleanup helper must not set the action idle by itself; only the runtime state machine can finalize after both the action promise and cleanup barrier settle.

### 6.5 Safety supervisor

Refactor modes into **intent producers** supervised by one arbiter:

- `self_preservation`: immediate environment escape/recovery intent;
- `danger`: choose exactly one of `evade`, `close_defend`, `hold_and_settle`, `eat/recover`;
- `unstuck`: low-priority recovery when no urgent danger owns motion;
- opportunistic modes: hunting, item collection, torch placement only while no higher-priority work owns motion.

Inputs should be a stable snapshot: health/food, recent damage time, velocity/knockback settling, hostile identity/distance/count, equipment, terrain hazard, current action, and cooldowns. Output is a typed safety intent with an expiry, not an immediate skill call.

Combat invariants:

- evade uses no attack call;
- close defense uses no pathfinder chase;
- damage stops all existing pursuit before another controller starts;
- PVP/manual attack is bounded by range, time, health floor, and target validity;
- the verifier requires disengagement/target outcome plus cleanup evidence;
- invalid-movement disconnects record controller ownership and recent physics/damage events for diagnosis.

### 6.6 Macro registry and ActionGraph

ActionGraph should live **above** the hardened `ActionRuntime`. It should not replace `ActionManager` in the first patch and must not wrap the current Boolean lifecycle as if that made it safe. Evolve `ActionManager` into a compatibility facade that delegates admission/execution to `ActionRuntime`; direct commands can submit one primitive request, while macro commands submit a graph whose ready nodes use that same runtime. Retire the facade only after existing callers have migrated.

Start with persisted, serial execution. Parallel graph nodes are unnecessary until resource locking and multi-bot ownership exist.

```js
ActionGraph = {
  graphId, macroName, version, actorId, status,
  input, createdAt, updatedAt, nodes, evidenceRefs
}

ActionNode = {
  nodeId, name, kind, version, status, dependsOn,
  actionRef, input, requirementRefs, preconditionRef,
  resourceLeases, safetyPolicy, cancellationPolicy,
  verifierRef, retryPolicy, resumePolicy, checkpointPolicy,
  expectedEventTypes, attempts, result, evidenceRefs
}
```

For a macro node, expansion records its child node ids and expansion version in graph state. Required inventory/tools/world state belong in typed `requirementRefs`/condition nodes rather than prose. Cancellation, safety, verification, retry, resume, and expected-event policy must resolve through versioned registry ids so the persisted graph remains data, not executable closures.

Node kinds:

- `primitive`: deterministic registered action;
- `macro`: expansion into child nodes;
- `condition`: deterministic observation/precondition;
- `ai_checkpoint`: typed choice only when deterministic routing is insufficient;
- `wait`: bounded external/game-state wait;
- `compensation`: return/close/recover action after a partial mutation.

Register macros as versioned, deterministic expanders. Each entry should declare `macroId`, version, input schema, expansion function, allowed child macro/primitive ids, and an optional migration policy. Expansion consumes validated JSON plus deterministic game data and returns JSON-serializable nodes; it must not perform Mineflayer work or persist closures. `!fullAcquire(...)`, function calling, and self-prompt planning all enter through the same `IntentGateway` and `MacroRegistry` request.

Register primitives with `primitiveId`, version, input schema, declared resource leases, bounded execution function `(context, input, signal)`, verifier id, cleanup policy, timeout ceiling, idempotency/resume policy, and result/evidence schema. Initially adapt known functions in `src/agent/library/skills.js`; do not copy them into a second competing implementation tree. Generated micro-actions register only as ephemeral checkpoint actions with stricter capability/budget metadata.

Cancellation is hierarchical and carries a reason. A graph-level token creates a node-level child token, which is passed through `ActionRuntime` into the primitive or isolated generator. Cancelling a graph stops admission of new nodes, marks the active node `cancelling`, propagates the signal, awaits runtime cleanup/quiescence, records `cancelled` or `interrupted_unknown`, then checkpoints the graph. A timeout, user stop, disconnect, safety preemption, and shutdown use distinct reason codes. No graph state becomes `paused`/`cancelled` while its physical action remains live.

Safety modes are supervisors, not ordinary child nodes. Cowardice/self-defense/unstuck submit priority intents to the arbiter. If safety must preempt a macro, the scheduler checkpoints its ready/running boundary, requests cancellation, waits for quiescence, runs the bounded safety action through the same runtime, re-observes/verifies changed preconditions, and then resumes, replans, or blocks the macro. The graph never assumes its pre-danger inventory, position, target, or route is still valid.

For `!fullAcquire("diamond", 64)`, a macro expander should create nodes for health/food readiness, tool-tier requirements, travel/mining strategy, acquisition count, return, and deposit. Each node references a registered primitive or nested macro; it does not store generated JavaScript. Resource quantities and recipe prerequisites should come from deterministic game data/planners inspired by CE's crafting-plan query, Co-Voyager, and Odyssey's acquisition catalog.

Use dependency cycle checks and checkpoint versions inspired by PlanBeads, while keeping the schema far smaller. Persist with atomic temp-file-and-rename writes plus append-only event JSONL. On load, validate the schema before executing anything.

Keep this implementation initially under `src/agent/` because it coordinates the existing `Agent`, runtime adapters, and skills:

```text
src/agent/action_graph/
  action_graph.js
  action_node.js
  action_registry.js
  action_runner.js
  cancellation_token.js
  verification.js
  resume_store.js
  event_log.js
src/agent/macros/
  full_acquire.js
  require_food.js
  require_tool_tier.js
  return_home.js
src/agent/runtime/
  primitive_registry.js
  verifier_registry.js
```

The exact casing is less important than one registry and one execution authority. Avoid parallel registries under both `src/actiongraph/` and `src/actions/`; that would recreate split ownership at the module level.

### 6.7 Verification layer

Create a registry keyed by verifier id:

| Verifier | Required evidence | Success condition |
|---|---|---|
| `distance_to_position` | before/after position, goal radius | inside radius, or explicit progress if node permits partial |
| `inventory_delta` | item counts before/after | delta meets requested output/count |
| `block_state` | target block before/after | expected block appeared/disappeared |
| `container_delta` | container and inventory snapshots | transfer count is correct |
| `craft_output` | recipe request + inventory snapshots | expected output increased |
| `smelt_output` | furnace slots + inventory snapshots | output count increased and window closed |
| `combat_disengaged` | target validity/distance, health, controller cleanup | target gone/safe distance and motion quiescent |
| `permission_probe` | dig attempt, block position, server response/context | distinguish protected/denied from unreachable/protocol |

Primitive code returns raw evidence; the verifier makes the success decision. LLM narration and expected outcomes never satisfy a verifier.

### 6.8 Generated micro-actions

Admission requirements:

- no existing primitive/macro can express the bounded local gap;
- maximum scope is a short local maneuver, not resource progression or survival policy;
- source implements a fixed `run(ctx, params, signal)` contract;
- only a capability-safe helper object is provided—never raw `agent`, filesystem, network, process, module loader, or unrestricted `bot`;
- parse with an AST and reject imports, dynamic property escapes, global access, unbounded loops, unused schema fields, and unapproved helpers;
- run in a separate worker/process or genuinely hardened isolate that can be terminated;
- enforce wall time, helper-call count, movement distance, block mutation count, and output size;
- record helper calls and compact source digest/path, not full source in conversational history;
- require an independent registered verifier;
- a successful one-off action does not automatically become permanent. Promotion requires repeated evidence/review or an explicit policy.

Prompt strategy: request short code, no comments except non-obvious safety, semicolons, no empty catches, and use only documented helpers. Run targeted safe autofix only for formatting/lint rules; never autofix capability or control-flow violations. A lint pass is necessary but not a sandbox.

### 6.9 AI checkpoints

An AI checkpoint receives:

- graph/node ids and objective;
- bounded current observation and scan limits;
- completed/blocked dependency summaries with evidence refs;
- allowed transition ids and strict parameter schemas;
- retry constraints and safety state.

It returns exactly one transition/repair proposal. The runtime validates it. AI checkpoints cannot mark nodes successful, clear safety constraints, or generate physical arguments from prose outside structured output.

### 6.10 Persistence, resume, and graph logging

Persist per bot:

- active graph and node states;
- graph event log;
- latest verified inventory/position/dimension/vitals snapshot;
- retry constraints and failure classifications;
- macro version and primitive/verifier registry versions;
- generated micro-action candidates/evidence outside chat history.

Write an append-only event record for every graph lifecycle transition: `graph_created`, `macro_expanded`, `node_ready`, `node_started`, `cancel_requested`, `cleanup_completed`, `node_verified`, `node_retry_scheduled`, `safety_preempted`, `node_blocked`, `graph_paused`, `graph_resumed`, and terminal graph state. Each event should carry timestamp, graph/node/action ids, source/owner, macro/registry versions, reason code, attempt, cancellation lineage, verifier id, compact evidence refs, cleanup/quiescence status, and correlation id. Human logs may render a concise tree, but JSONL is the source for diagnosis. Do not place raw generated source, full prompt text, or mutable closures in graph state.

On startup/reconnect:

1. load and validate records;
2. mark any `running` node `interrupted_unknown`;
3. run motion cleanup before admitting work;
4. observe current world/inventory state;
5. rerun the node's idempotent verifier;
6. mark it succeeded if evidence proves completion, otherwise ready/retryable/blocked according to policy;
7. resume the graph's ready front.

Never serialize function closures as resume state. Store action ids and JSON inputs that can be resolved through a versioned registry.

## 7. Prioritized implementation roadmap

### Phase 0: baseline cleanup

Goal: establish reproducible behavior and protect the patch sequence.

- Add `test/runtime/` with Node's built-in test runner and fixtures for fake agent/bot/plugin state.
- Add test scripts to `package.json`; do not upgrade dependencies.
- Add characterization tests for `ActionManager` admission, catch order, timeout state, duplicate labels, and resume behavior.
- Add focused tests for command parsing/blacklisting in `src/agent/commands/index.js`.
- Add characterization snapshots for current `Prompter` merging and each prompt purpose before extracting static text.
- Add `src/config/profile_resolver.js`, `src/config/instruction_loader.js`, and `src/models/prompt_assembler.js` behind the current `Prompter` API. Test ordered composition, canonical-root confinement, symlink/path traversal, missing files, duplicate files, UTF-8/size bounds, stable hashes, and purpose-specific inclusion.
- Add the `agents/` and `prompts/runtime/` configuration shape with a minimal example profile. Treat UI profile layer paths as references to server-owned files; do not upload/read browser-local paths.
- Emit an instruction manifest at startup and in prompt diagnostics while keeping instruction contents out of public settings and memory. Preserve legacy inline profile prompts during the migration.
- Add a startup/runtime diagnostic record that includes server address/version, bot position, dimension, op/permission uncertainty, and whether a block is within the configured spawn region. Do not change server settings.
- Document the baseline commit and known reference snapshots in this report/README linkage, but keep architecture detail here.
- Keep viewer/vision off in stability profiles until separately tested; do not delete the feature.

Exit gate: test command exists; current behavior is characterized; a test profile composes ordered instruction layers identically through CLI and MindServer creation; missing/out-of-root files fail clearly; no action/mode behavior has been broadly rewritten.

### Phase 1: runtime safety

Goal: one action owner and quiescent cancellation.

- Fix `src/agent/library/lockdown.js` naming and add a real containment test before trusting codegen.
- Harden `src/models/prompter.js#promptCoding` with a `try/finally` mutex and explicit busy result; never synthesize code.
- Add duplicate same-label admission policy to `src/agent/action_manager.js`.
- Add `src/agent/runtime/motion_cleanup.js` with idempotent subsystem cleanup and a structured report.
- Correct catch ordering, error stack preservation, and per-action timeout reset in `src/agent/action_manager.js`.
- Introduce action ids/generations and explicit lifecycle states behind the existing `runAction()` API.
- Pass an `AbortSignal`/action context into newly migrated actions; keep `bot.interrupt_code` only as a compatibility projection.
- Add a cancellation barrier: action promise settled + cleanup verified. Never force idle while the promise is live.
- Add `src/agent/runtime/action_result.js` and migrate `goToPosition` first; make wrapper calls propagate failure truthfully.
- Add disconnect/death cleanup that is awaited where the event API permits and writes a lifecycle diagnostic.

Exit gate: tests prove stale action finalizers cannot clear a newer action; duplicate `newAction` cannot reenter; a timed-out fake pathfinder action cannot admit a successor before cleanup.

### Phase 2: combat and danger reliability

Goal: eliminate mixed controller ownership and invalid-movement failure chains.

- Add `src/agent/runtime/safety_snapshot.js` and `danger_arbiter.js`.
- Refactor `src/agent/modes.js` so modes propose intents rather than directly compete for motion.
- Split `avoidEnemies` into flee-only behavior; remove its attack call.
- Replace `defendSelf` with bounded close-defense: no pathfinder chase, health floor, range limit, deadline, and cleanup in `finally`.
- Add a post-damage settle gate based on physics ticks/recent velocity before movement admission.
- Add structured controller diagnostics on kick/disconnect in `src/agent/connection_handler.js` or the current connection event path.
- Add deterministic tests for priority/handoff and mocked controller ownership, then a controlled private-server matrix for zombie hit, skeleton knockback, water, lava edge, and simultaneous mode triggers.

Exit gate: logs show one motion owner across damage; cowardice never attacks; self-defense never starts pathfinder chase; every combat exit reports cleanup state.

### Phase 3: ActionGraph macro tasks

Goal: resumable deterministic long-horizon execution.

- Add `src/agent/action_graph/types.js`, `validators.js`, `store.js`, `event_log.js`, and `scheduler.js`.
- Add versioned registries under `src/agent/runtime/primitive_registry.js` and `verifier_registry.js`.
- Add `src/agent/macros/registry.js` and small expanders for readiness checks, item acquisition, return-home, and deposit.
- Add a command-edge parser for `!fullAcquire` in `src/agent/commands/actions.js`; translate it to a typed macro request.
- Add deterministic recipe/tool prerequisite expansion using `minecraft-data`; do not ask the LLM to rediscover fixed recipes.
- Add atomic graph checkpointing under `bots/<name>/tasks/` and reconcile on startup.
- Execute graph nodes serially at first. Add retry policy/reason codes and exact-args loop prevention.
- Add an `ai_checkpoint` node type only after deterministic node execution/resume works.

Exit gate: interrupt/restart a multi-node acquisition fixture at every node boundary and obtain the same verified final state without replaying completed mutations.

### Phase 4: generated micro-actions

Goal: safe fallback for bounded gaps.

- Replace direct staging in `src/agent/coder.js` with a candidate contract under `src/agent/generated/`.
- Add AST validation, helper/schema matching, budgets, and code digesting.
- Implement a separate-process executor with hard termination and no raw bot/agent authority.
- Add helper-call event capture and independent verifier selection.
- Keep generated source out of `History`; store artifact path/hash and bounded diagnostics.
- Add candidate/trial/rejected/promoted directories and records, inspired by the community runtime but simplified.
- Add lint formatting/autofix only after capability validation and test it against the known semicolon/empty-catch cases.

Exit gate: malicious/global-access fixtures are rejected; infinite/ignored-signal code is terminable; a two-block bridge micro-action is promoted only after block-state verification.

### Phase 5: memory, RAG, and long-term autonomy

Goal: retrieve useful evidence without turning memory into authority.

- Separate episodic outcomes, semantic facts, locations, failure/retry knowledge, and reusable action knowledge under `bots/<name>/memory/`.
- Keep all of those stores downstream of the immutable instruction manifest. Memory retrieval may inform a prompt section but may not add, reorder, or overwrite instruction layers.
- Index compact evidence-backed records, not full raw conversations or unverified model claims.
- Rank action/macro reliability using structured reason codes and verifier results; keep precondition failures separate from implementation failures.
- Retrieve only relevant records for planning, with source refs and recency/confidence.
- Compact history while retaining active ActionGraph summaries, blockers, safety state, and evidence refs.
- Add offline trajectory evaluation and macro success metrics before self-modifying policy.
- Consider multi-bot coordination only after single-bot resource/action ownership is robust; use explicit task/resource leases rather than shared bulletin prose alone.

Exit gate: a restarted bot resumes a long graph, uses a prior verified blocker/location appropriately, and never treats retrieved prose as execution permission or success.

## 8. Do not do this

- Do not perform a broad rewrite before characterization tests and live diagnostics exist.
- Do not reset to stable expecting the action bugs to disappear; the critical runtime is shared.
- Do not permanently disable `newAction`, cowardice, self-defense, or unstuck. Fix admission and handoff.
- Do not let a safety mode invoke a skill directly while another controller still owns motion.
- Do not mix attack behavior into cowardice or pathfinder chase into damage-time close defense.
- Do not run unbounded pathfinder/PVP movement during damage or knockback.
- Do not “solve” cancellation by setting `executing=false`, resolving a timeout race, or marking the bot ready while the old promise can continue.
- Do not assume `pathfinder.stop()` cancels collectBlock, PVP, digging, windows, listeners, or generated code.
- Do not use process kill as routine cancellation; reserve it for explicit quarantine recovery.
- Do not let generated code perform planning, survival policy, acquisition chains, or arbitrary Mineflayer access.
- Do not call `eval`, `new Function`, `vm.createContext`, SES, or dynamic import a sandbox merely because a regex/allowlist exists. Prove the boundary or isolate it externally.
- Do not disable lint globally. Fix prompts and apply narrowly tested formatting autofixes after capability validation.
- Do not echo full generated source into conversation history or normal action logs.
- Do not use model narration, critic opinion, a command return, or “promise resolved” as proof of success.
- Do not silently infer missing physical parameters from rationale text.
- Do not store closure functions as resumable task state.
- Do not turn every goal into generated code, every failure into an LLM checkpoint, or every observation into RAG.
- Do not require one OpenClaw workspace, `AGENTS.md`, finetune, or provider adapter per Minecraft character. Keep the backend generic and the bot configuration in Mindcraft Plus.
- Do not mix durable instruction files into `History`, let retrieved memory become an instruction layer, or silently treat a missing instruction as empty text/default personality.
- Do not let provider adapters read profile files, let browser uploads select arbitrary host paths, or log full instruction contents unless full prompt logging is explicitly enabled.
- Do not rely on layer order to enforce safety. Profile prose cannot grant runtime capabilities, bypass blocked actions, choose concurrent motion owners, or override server policy.
- Do not transplant the community repository's entire schema/research architecture. Take only the authority, evidence, retry, graph, and lifecycle ideas needed here.
- Do not transplant OpenPlayer's large defense mode or the swarm's watchdog pattern.
- Do not classify block failure as a protocol bug until permissions, spawn protection, loaded chunks, reachability, tool requirements, and target state are recorded.
- Do not run `npm audit fix`, upgrade dependencies opportunistically, or change server configuration as part of these patches.

### 6.10 LocalBlockMap: deterministic local geometry, not LLM perception

Before advanced building intelligence, add a runtime-owned `LocalBlockMap` (also called a `BlockSnapshot` at the immutable data boundary). This is a reusable observation layer, not a building planner and not an LLM tool that returns free-form prose. It gives primitives a bounded, timestamped representation of nearby geometry so that they can make and verify spatial claims deterministically.

**Boundary and ownership.** The module belongs below skills/ActionGraph primitives and above Mineflayer's `bot.blockAt` adapter. It must never mutate the world, start pathfinding, make placement decisions, or hold a motion lease. An ActionGraph node such as `findSafeStandPosition` can request a snapshot/query, but the graph and LLM only receive typed summary/evidence derived from it. The LLM must not infer geometry from text such as “some blocks are nearby.”

**Snapshot contract.** Start with an immutable, versioned shape, for example:

```js
BlockSnapshot = {
  schemaVersion: 1,
  capturedAt, dimension, origin, bounds, options,
  blocksByRelativeKey, // `${dx},${dy},${dz}` -> BlockCell
  scanStats: { requested, observed, unloaded, missing },
}

BlockCell = {
  relative: { x: dx, y: dy, z: dz },
  position: { x, y, z },
  name, type, metadata,
  stateId, boundingBox,
  isAir, isLiquid, isSolid, isPassable,
  isDoor, isContainer, isBed, isLog, isOre,
  observed: true,
}
```

The origin is `floor(bot.entity.position)` at capture time. A scan visits every integer coordinate in a documented, deterministic order—Y ascending, then Z ascending, then X ascending—over `[-radius, radius]` horizontally, `[-heightDown, heightUp]` vertically. A missing/unloaded `bot.blockAt` result is represented explicitly; it is never silently treated as air. Classification comes from Mineflayer/prismarine registry data plus a narrow, versioned tag table (for example `*_log`, `*_ore`, `*_door`, container/bed IDs). Callers may provide a predicate, but the map itself must expose plain data rather than depend on LLM-generated callbacks.

**Core query surface.** Keep queries pure and stable: `getRelative`, `getAbsolute`, `cells`, `findNearest({ names, types, predicate, maxDistance })`, `findAll`, `isPassable`, `isStandable(position)`, `getFloor(position)`, `hasHeadroom(position, height=2)`, `getPlaceableFaces(position)`, and `summarize()`. Distance ties must resolve by the scan order/key, not object enumeration or Mineflayer entity order. `isStandable` requires an observed solid/supporting floor plus observed passable feet and head cells; it must distinguish unknown/unloaded from false. `getPlaceableFaces` must identify an observed solid neighbor and the adjacent passable target cell, returning face normal, support position, target position, and reachability evidence—not claim that a placement succeeded.

**Derived detectors.** Build these as explicit queries over the snapshot rather than special cases spread through skills: footing/walls/headroom, water/lava proximity, nearby doors/chests/beds/logs/ores, hole detection, water/hole/obstruction occupancy, and safe stand candidates. Later deterministic compositions can identify clear volumes, flat build areas, wall planes, corners, and shelter candidates. Each answer carries the snapshot bounds, capture time, candidate positions, and any unknown cells; negative claims remain bounded (for example, “no chest observed within horizontal radius 8, Y -3..+4”).

**Caching and freshness.** Cache only a completed immutable snapshot, keyed by dimension, floored origin, normalized bounds/options, and a short TTL (initially 250–500 ms). Reuse is valid only when the bot remains in the same floored block/dimension and no explicit invalidation occurred. Invalidate after block updates, dig/place/use outcomes, teleport/dimension transition, and action cleanup that reports movement. Do not cache a partial scan as complete; include a monotonic snapshot ID so evidence can identify exactly what it used. A caller that needs a stronger guarantee may request `fresh: true`; it should still receive an explicit scan budget and incomplete/unloaded status rather than a fabricated answer.

**ActionGraph mapping.** The first consumers should be narrow deterministic primitives: `checkFooting`, `findNearbyResource`, `findSafeStandPosition`, `validateBlockPlacement`, `validateMiningTarget`, `findShelterCandidate`, `findFlatBuildArea`, and `detectHazardNearby`. Their results should use the existing action-result envelope (`status`, `reasonCode`, `retryable`, evidence), with snapshot ID/bounds as evidence. `validateMiningTarget` additionally checks target identity, reachability, tool/harvest preconditions, and unknown neighbors; `validateBlockPlacement` checks support face, target passability, collision/clearance policy, and expected post-place block state. Neither is authorization to mutate—the following primitive still performs and verifies the action.

**Initial implementation seam.** Add `src/agent/runtime/local_block_map.js` plus a thin Mineflayer adapter and fixtures under `test/runtime/local_block_map.test.js`. Begin with capture, classification, nearest lookup, standability, hazards, and cache invalidation tests using a fake block source; avoid coupling the module to `world.js` until it replaces a specific ad-hoc scan. The first live-server validation should compare a small snapshot against manually inspected terrain and exercise unloaded-edge behavior. Do not begin structure construction, area scoring, generated building code, or LLM-directed placement until this layer is proven truthful.

### 6.11 Water safety: deterministic recovery owns navigation until grounded

Water is a first-class safety/navigation state, not an inconvenient land-pathfinding surface. A bot that is submerged, sinking, or unable to leave water must suspend normal movement ownership through the same action-generation/quiescence protocol used for damage and other safety interruptions. The LLM may select a broad goal, but it must neither decide whether to surface nor issue ad-hoc swimming controls.

**Components.** Use four small runtime pieces with one owner at a time:

- `WaterDetector` reads Mineflayer entity/fluid state and a fresh `LocalBlockMap` to classify `dry`, `wading`, `swimming_surface`, `submerged`, `sinking`, `trapped_water`, or `hazardous_water`. Detection must expose raw observations (feet/head fluid cells, vertical velocity/position trend, oxygen/air value when the protocol provides one, adjacent lava, and snapshot ID), not infer from a chat or model description.
- `SwimController` is a bounded, signal-aware control primitive. It owns only the relevant controls, sets/clears them explicitly, and never runs concurrently with pathfinder, PVP pursuit, digging, or another controller.
- `ExitWaterAction` performs one deterministic recovery attempt: surface first, choose a verified exit, swim to it, clear controls, then verify grounded state. It returns the normal structured result envelope and never reports success merely because a pathfinder call settled.
- `WaterSafetyMode` is a high-priority safety arbiter. It requests interruption/cleanup of incompatible work, waits for the current motion owner to quiesce, runs one `ExitWaterAction`, and resumes the interrupted graph node only after ground verification and node reconciliation. It does not recursively invoke itself.

**Detection and exit selection.** Use a fresh nearby snapshot with enough vertical extent to see headroom, the local water column, and shoreline (initially horizontal radius 6–8, up 4, down 4; all bounds recorded in evidence). `isInWater` and `isHeadUnderwater` are direct state queries. A possible exit must have an observed solid supporting block, passable feet/head cells, no adjacent lava under the safety policy, and a route through observed water/passable cells. Rank candidates deterministically by: safe standability, no lava hazard, reachable elevation/route, shortest horizontal distance, smallest ascent, then snapshot coordinate key. Consider climbable exits only when their climbability and the destination's standability are observed. Unknown/unloaded cells cannot win an exit selection.

**Control and verification state machine.** The initial state machine should be `detect -> interrupt/cleanup -> surface -> select_exit -> swim_to_exit -> stabilize -> verify_grounded -> resume_or_block`.

1. In `submerged`, `sinking`, or drowning-risk states, `SwimController` holds jump/upward movement until the head-fluid observation becomes air or a bounded surface timeout expires. It samples observations at a fixed cadence; it does not use an unbounded `while` loop or blindly run land `pathfinder.goto`.
2. On the surface, it keeps upward/swim control only as needed while moving toward the selected exit. It must make measured position/progress toward the candidate; repeated no-progress samples trigger a fresh snapshot/reselection, not endless control input.
3. After reaching the candidate, it clears every control it owns, stops any temporary goal, waits a short stabilization window, and calls `verifyOnSolidGround`. Verification requires observed non-water feet/head, a solid support below, passable occupancy, and stable position/vertical motion. It is not enough that the bot is near a shore block.
4. Only verified grounding permits the interrupted action to reconcile and continue. Otherwise return `blocked`, `cancelled`, or `unsafe` with a reason such as `water_exit_not_found`, `surface_timeout`, `water_exit_stalled`, `ground_verification_failed`, or `lava_adjacent`; leave the original action paused/blocked rather than pretending to resume it.

**Budgets, loop prevention, and cleanup.** Bound surface time, exit time, total recovery time, reselections, and identical-candidate retries. Persist a compact recovery record keyed by snapshot/candidate/reason so repeated failures enter a cooldown/quarantine/AI-checkpoint path instead of cycling. A cancellation signal always clears water controls in `finally`; successful and failed exits both log transition, selected candidate, snapshot ID, elapsed time, progress samples, and final ground verification. The controller must use the existing cleanup report before yielding ownership, so water recovery cannot create a second motion actor.

**Public primitive shape.** Provide deterministic APIs such as `isInWater(bot)`, `isHeadUnderwater(bot)`, `findNearestWaterExit(bot, snapshot)`, `swimToSurface(bot, { signal, timeoutMs })`, `swimToExit(bot, exit, { signal, timeoutMs })`, `exitWater(bot, options)`, and `verifyOnSolidGround(bot, snapshot)`. The latter operations return structured action results with before/after fluid and position evidence, selected exit, scan bounds, retry count, cleanup report, and reason code. A Boolean compatibility adapter, if needed for legacy callers, may return true only for verified grounding.

**Implementation boundary.** Add the detector/controller/action as separate runtime modules after `LocalBlockMap`; do not embed water loops in `skills.js`, `modes.js`, or generated code. Unit fixtures must cover surface recovery, safe shore ranking, blocked/unloaded exits, lava rejection, cancellation/control cleanup, stalled movement, and refusal to resume before grounding. Live validation should begin in a shallow controlled pool and then test a vertical water column and hostile shoreline, with server-specific fluid/oxygen observations recorded before changing thresholds.

## 9. Immediate next patches, in order

These are intentionally small. Test commands assume each patch adds the named script/test before the command is used.

### Patch 1 — establish a lifecycle characterization harness

- **Files:** `package.json`; new `test/runtime/action_manager.test.js`; new `test/helpers/fake_agent.js`.
- **Reason:** protect current semantics and reproduce reentry, timeout, catch, and stale-finalizer failures without Minecraft.
- **Risk:** low; tests may expose awkward dependency injection needs.
- **Test:** `node --test test/runtime/action_manager.test.js`
- **Expected output:** named tests for ordinary completion, interruption request, duplicate-label reproduction, timeout state, and thrown action; failures document current defects before fixes.

### Patch 2 — fix and prove SES lockdown invocation

- **Files:** `src/agent/library/lockdown.js`; new `test/runtime/lockdown.test.js`.
- **Reason:** the exported wrapper currently recurses into itself, so codegen's claimed security initialization is not established.
- **Risk:** medium/high; real SES lockdown can expose incompatible dependency/global assumptions and is process-global.
- **Test:** `node --test test/runtime/lockdown.test.js`
- **Expected output:** lockdown initializes once, a compartment can execute the allowed fixture, and forbidden globals such as `process`/`require` are unavailable. If dependency compatibility fails, keep coding disabled and record the blocker rather than weakening the test.

### Patch 3 — make coding reentry explicit and exception-safe

- **Files:** `src/models/prompter.js`; `src/agent/coder.js`; new `test/runtime/coder_mutex.test.js`.
- **Reason:** prevent `action:newAction` reentry from producing the bogus `//no response` program and ensure API failures release the mutex.
- **Risk:** low/medium; callers must handle a typed busy/failure result instead of a fake response.
- **Test:** `node --test test/runtime/coder_mutex.test.js`
- **Expected output:** `coding request already in progress` is logged once; no staged 1-line program is created; a rejected provider call leaves the next request admissible.

### Patch 4 — reject/coalesce duplicate active action labels

- **Files:** `src/agent/action_manager.js`; `test/runtime/action_manager.test.js`.
- **Reason:** stop `action:newAction` from interrupting itself while preserving interruption by genuinely different, higher-priority work.
- **Risk:** medium; legitimate repeated labels may need an explicit `replace` policy later.
- **Test:** `node --test test/runtime/action_manager.test.js`
- **Expected output:** `action_rejected duplicate_active_label action:newAction`; current action id remains unchanged; no interrupt request is issued.

### Patch 5 — centralize idempotent motion cleanup and diagnostics

- **Files:** new `src/agent/runtime/motion_cleanup.js`; `src/agent/agent.js`; new `test/runtime/motion_cleanup.test.js`.
- **Reason:** create one ordered cleanup inventory for collectBlock, PVP, pathfinder, digging, active item, controls, and windows.
- **Risk:** medium; plugin APIs differ and some stops are synchronous/best-effort.
- **Test:** `node --test test/runtime/motion_cleanup.test.js`
- **Expected output:** a structured report such as `motion_cleanup action=<id> collect=stopped pvp=stopped pathfinder=stopped digging=stopped controls=clear quiescent=true`; calling cleanup twice is harmless.

### Patch 6 — repair catch/timeout result semantics

- **Files:** `src/agent/action_manager.js`; `test/runtime/action_manager.test.js`.
- **Reason:** reset timeout state per action, preserve stacks, request cleanup before final idle state, and stop claiming success from stale state.
- **Risk:** medium; idle/mode timing may change, which is desirable but observable.
- **Test:** `node --test test/runtime/action_manager.test.js`
- **Expected output:** thrown action returns its real stack; cleanup runs while state is `cancelling`; a later action reports `timedout:false`; idle emits only after cleanup.

### Patch 7 — add action generation ownership and quiescence barrier

- **Files:** `src/agent/action_manager.js`; new `src/agent/runtime/action_context.js`; expanded lifecycle tests.
- **Reason:** prevent an old promise/finalizer from clearing or emitting idle for a newer action and prohibit blind force-clear.
- **Risk:** high but localized; this is the first fundamental lifecycle change.
- **Test:** `node --test test/runtime/action_manager.test.js`
- **Expected output:** `stale_finalizer_ignored action=<old>`; successor starts only after `action_quiescent`; a deliberately non-cooperative action enters `quarantined` and no successor runs.

### Patch 8 — separate flee-only and close-defense behavior

- **Files:** `src/agent/library/skills.js`; `src/agent/modes.js`; new `test/runtime/danger_modes.test.js`.
- **Reason:** directly address the invalid-movement chain without disabling modes.
- **Risk:** medium/high; combat efficacy may initially drop while safety improves.
- **Test:** `node --test test/runtime/danger_modes.test.js`
- **Expected output:** cowardice calls no attack/PVP method; close defense calls no pathfinder `goto`/follow; damage handoff logs one motion owner and cleanup before/after.

### Patch 9 — migrate one movement primitive to a truthful result

- **Files:** `src/agent/library/skills.js` (`goToPosition`, then nearest wrappers); new `src/agent/runtime/action_result.js`; new `test/runtime/movement_result.test.js`.
- **Reason:** establish the structured-result pattern and stop wrappers from returning true after nested failure.
- **Risk:** medium; existing callers expect Booleans and need a compatibility adapter.
- **Test:** `node --test test/runtime/movement_result.test.js`
- **Expected output:** `status=arrived|progressed|blocked|cancelled`, before/after distance, reason code, and cleanup state; nearest wrappers propagate `blocked`.

### Patch 10 — add inventory-delta verification for collection/crafting

- **Files:** `src/agent/library/skills.js`; new `src/agent/runtime/verifiers.js`; new `test/runtime/inventory_verifier.test.js`.
- **Reason:** stop partial collection or a fulfilled craft call from satisfying a requested quantity without evidence.
- **Risk:** medium; item drops/pickup latency needs a bounded settle window.
- **Test:** `node --test test/runtime/inventory_verifier.test.js`
- **Expected output:** requested, before, after, delta, and `verified_count`; partial acquisition returns `partial`/retryable rather than success.

### Patch 11 — introduce bounded LocalBlockMap capture and pure spatial queries

- **Files:** new `src/agent/runtime/local_block_map.js`; new `test/runtime/local_block_map.test.js`; targeted callers only after query fixtures pass.
- **Reason:** replace repeated ad-hoc nearby-block observations with deterministic, bounded geometry evidence for future safety, mining, placement, and building primitives.
- **Risk:** medium; Minecraft block classification and unloaded chunks must not be flattened into optimistic air/passability.
- **Test:** `node --test test/runtime/local_block_map.test.js`
- **Expected output:** deterministic coordinate indexing/tie breaks; explicit unloaded cells; correct standability/placeable-face/hazard results; cache hit only within TTL and same origin/dimension; movement and block-update invalidation produces a new snapshot ID.

### Patch 12 — add deterministic water detection and bounded exit recovery

- **Files:** new `src/agent/runtime/water_detector.js`, `swim_controller.js`, and `exit_water.js`; targeted safety-mode integration; new `test/runtime/water_recovery.test.js`.
- **Reason:** land pathfinding does not reliably surface, float, or exit water; water recovery needs one deterministic owner and ground-verified handoff.
- **Risk:** high; fluid-state semantics and movement controls require controlled live validation, and incorrect handoff could reintroduce concurrent motion ownership.
- **Test:** `node --test test/runtime/water_recovery.test.js`
- **Expected output:** submerged fixture surfaces with bounded jump control; safe exit ranking rejects lava/unknown/blocked candidates; no-progress exhausts a finite recovery budget; cancellation clears controls; interrupted work remains paused until `verifyOnSolidGround` succeeds.

Do not begin the ActionGraph implementation until patches 1–8 have passed unit fixtures and at least the controlled damage/movement live matrix. Patches 9–10 establish the result/verifier seam ActionGraph will depend on.

## 10. Terminal recommendation summary

- **Base:** keep the current checkout, but treat Mindcraft CE stable `42da10d` as the baseline lineage; do not reset because the critical runtime is identical and current develop contains small useful fixes.
- **Top three inspirations:** `minecraft-llm-agent-community` for authority/evidence/persistent graph contracts; Minecraft Agent Swarm for typed outcomes, stall-aware movement, and reliability telemetry; Voyager/Co-Voyager for verified skill promotion and explicit decomposition.
- **Profile/instruction boundary:** Mindcraft Plus owns ordered, server-local instruction layers and purpose-aware prompt assembly; memory stays dynamic state and OpenClaw/providers remain generic inference backends. Load once, validate strictly, and log a path/hash manifest.
- **ActionGraph placement:** put the persisted graph above a hardened `ActionRuntime`; retain `ActionManager` only as a temporary compatibility facade. Macro and primitive registries are versioned, cancellation flows graph -> node -> runtime -> primitive, and safety preemption resumes only after quiescence and state reconciliation.
- **Top five patches:** lifecycle test harness; SES lockdown fix/test; exception-safe coding mutex; duplicate-label admission; centralized motion cleanup.
- **Biggest architectural risk:** any scheduler that marks an action stopped or timed out before the underlying Mineflayer/plugin promise and all motion controllers are quiescent. That creates two simultaneous owners and can reproduce invalid movement, corrupted state, and false task progress even under a new ActionGraph.
