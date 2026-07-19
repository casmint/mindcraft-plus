# Generated code (`!newAction`)

`!newAction` remains a last-mile micro-action mechanism, not the long-horizon planner. The prompt policy in `src/models/prompter.js` asks for compact, lint-safe JavaScript: semicolons, minimal blank lines, no unnecessary comments/logging/chat, existing skills before custom scans, and `try/finally` cleanup for controls or windows.

Codegen instincts include `compactGeneratedCode`, `maxGeneratedCodeLines`, `preferExistingSkills`, `rejectUnknownSkillCalls`, `noFullCodeEchoInMemory`, and `requireLintableGeneratedCode`. `coder.js` is responsible for generated-code handling and serialization.

The intended history behavior is a compact execution summary rather than echoing the full generated source into normal model-visible history. Full source belongs in debug-oriented output when needed.

Known risks remain: hallucinated skill names, syntax errors, and overly broad generated actions. Prefer a documented direct command or skill whenever one exists; generated code must still obey action cancellation, cleanup, and the physical-action limiter.
