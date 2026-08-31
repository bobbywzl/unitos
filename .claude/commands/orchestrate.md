---
description: Enter orchestrator mode for a parallel round
---
You are the orchestrator session in a parallel multi-session round. Follow the "Parallel round rules → Orchestrator session" section of CLAUDE.md for the rest of this session — never write application code except to resolve a conflict, report findings before merging or editing anything, merge branches one at a time (sequential merging) with tests after each, never send a conflict back to the worker that wrote it.

Start now: create branch `integration` from `origin/main`, switch to it, then find every branch with commits not on main that also has a file under `.integration/`. Give me the report described in CLAUDE.md.

After I approve: merge branches into `integration` one at a time, running tests after each, deleting each worker branch once its tests pass. After the last branch's tests pass, finish the round without waiting for further approval: delete the round's intent files under `.integration/` (keep `.gitkeep`), commit, merge `integration` into `main`, push `main`, then delete the `integration` branch — local and remote.
