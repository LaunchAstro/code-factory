# herdr commands

Reference for the [herdr skill](SKILL.md). `herdr <group> --help` lists every flag; this page keeps the shapes and habits the help does not.

## Concepts

- **Workspace**: a project context holding tabs. Unless renamed, its label follows the first tab's root pane: the repo name, otherwise the folder name.
- **Tab**: a subcontext holding panes. **Pane**: a terminal split running its own process (shell, agent, server, log).
- **You**: the focused pane in `herdr pane list`. The others are neighbours.
- **`done`**: the agent finished and nobody has looked at that pane yet.

## Output shapes

- `workspace list|create`, `tab list|create|get|focus|rename|close`, `pane list|get|split` and both `wait` commands print JSON.
- `pane read` prints text (`--format ansi` or `--ansi` for a rendered TUI snapshot). `send-text`, `send-keys` and `run` print nothing on success.
- New ids: `pane split` returns `result.pane.pane_id`; `tab create` returns `result.tab` and `result.root_pane`; `workspace create` returns `result.workspace`, `result.tab` and `result.root_pane` (resolve that pane id again, per the skill's rule 1).
- `wait` exits `1` on timeout.

## Commands

Take every `<ws>`, `<tab>` and `<pane>` from list or create output (skill rule 1).

```bash
herdr workspace list
herdr workspace create --cwd /path --label "api" --no-focus     # focus|rename <ws> "name"|close <ws>
herdr tab list --workspace <ws>
herdr tab create --workspace <ws> --label "logs" --no-focus      # focus|rename <tab> "logs"|close <tab>
herdr pane list [--workspace <ws>]
herdr pane read <pane> --source recent --lines 50                 # visible | recent | recent-unwrapped
herdr pane split <pane> --direction right --no-focus              # or --direction down
herdr pane run <pane> "npm run dev"                               # text plus Enter, for shells only
herdr pane close <pane>
herdr wait output <pane> --match "ready on port 3000" [--regex] --timeout 30000
herdr wait agent-status <pane> --status done --timeout 120000
```

Text into an agent TUI goes through the loop in [DELIVERY.md](DELIVERY.md), never a bare `send-text` then Enter.

- `--no-focus` keeps your own pane focused. Without `--label`, workspaces keep cwd naming and tabs keep numbers.
- `pane read` is for output that already exists; `wait output` is for output you expect next. `wait output --source recent` matches unwrapped text, so width and soft wraps do not break a match; read with `--source recent-unwrapped` to see what it matched.

## Recipes

Run a server and wait until it is ready (tests work the same with `--match "test result"`):

```bash
P=$(herdr pane split <pane> --direction right --no-focus | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$P" "npm run dev"
herdr wait output "$P" --match "ready" --timeout 30000
herdr pane read "$P" --source recent --lines 20
```

Watch another pane: read what is there (`--source recent --lines 40`), wait only for the next output you expect, then read `recent-unwrapped`.

Wait on another agent: `wait agent-status <pane> --status done`, then `pane read <pane> --source recent --lines 100`, then check its artefact (skill rule 9).

Start an agent in a pane: split, `pane run <pane> "claude"`, then prompt it through [DELIVERY.md](DELIVERY.md), with the executable the task declares.
