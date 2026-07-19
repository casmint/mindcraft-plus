# Testing and debugging

Run checks from the repository root.

```bash
node -e 'const fs=require("fs"); const YAML=require("yaml"); for (const f of fs.readdirSync("instincts").filter(f=>f.endsWith(".yaml"))) YAML.parse(fs.readFileSync("instincts/"+f,"utf8")); console.log("instinct yaml ok")'
node -e 'const fs=require("fs"); for (const f of fs.readdirSync("profiles").filter(f=>f.endsWith(".json"))) JSON.parse(fs.readFileSync("profiles/"+f,"utf8")); console.log("profiles json ok")'
find src -name '*.js' -print0 | xargs -0 -n1 node --check
npm run test:runtime
git diff --check
```

Use `rg -n 'water recovery|self_preservation|runtime soft-quarantine' src test` to locate safety behavior, and `rg -n 'instinct|instruction_layers|task_state' src profiles instincts` for configuration flow.

Useful startup/runtime logs include profile instruction and instinct load messages, `[runtime:direct] initialized`, `Loaded active task:`, `motion_cleanup`, `self_preservation skipped:`, `Runtime quarantined`, and `disconnect.spam`. A disconnect reason is evidence to investigate; it is not proof that a single subsystem caused it.

For a server run, use the profile and settings that will actually be deployed. Avoid treating isolated unit tests as proof of Mineflayer/server packet behavior.

## Admin manual checks

With an authorized local player, test: `!surfski help`, `!surfski status`, `!surfski chatlayer`, `!surfski chatlayer off`, `!surfski mode`, `!surfski mode cowardice off`, `!surfski profile`, and `!surfski profile list`. Verify the local authorization file is gitignored and contains only local usernames.
