# Trust gate

ops-astro is public, so anyone can comment on its pull requests, and lanes and
Sol act on what those comments say. `trust-gate.sh` is the read that passes on
only what our own people and bots wrote.

```sh
orchestration/trust-gate/trust-gate.sh LaunchAstro/ops-astro 1790
```

It prints the PR's comments, reviews and review comments as JSON, with
`kept` and `dropped` counts, and writes `trust-gate: kept K, dropped D` to
stderr. An item is kept only when its author and every editor in its history
are inside:

- a member of an org in [allow.json](allow.json), matched by id and login;
- a user `allow.json` names by id and login (Nathan-Mulligan);
- a bot `allow.json` names by id, and only on a repo one of those orgs owns,
  as GitHub reports it in the answer (a renamed or transferred repo is judged
  by its owner now, not by the path asked for).

Everyone else is dropped: outside collaborators, contributors, deleted
accounts, bots off the list, and a member's comment that an outsider edited.
[gate.jq](gate.jq) holds the rules and their reasons.

## Fails closed

A gh error, an org member list that comes back empty or without ids, a
missing or malformed allowlist (anything but one JSON document), a GraphQL error or a PR GitHub didn't return
all print `{"refused": ...}` with every list empty, exit 3, and write
`trust-gate: refused, dropped all` to stderr. A caller that pipes the output
into `jq '.comments[]'` gets nothing. Bad arguments exit 2 and print nothing.

## Using it in a script

Replace a direct comment read with the gate and the same filter:

```sh
# before
gh api "repos/$REPO/issues/$N/comments?per_page=100" --paginate --jq '.[] | .body'
# after
"$CF/orchestration/trust-gate/trust-gate.sh" "$REPO" "$N" 2>/dev/null | jq -r '.comments[] | .body'
```

`html_url` becomes `url`. Run it from a checkout of main, and set
`TRUST_GATE_ALLOW` only to a file outside the repo under review: a PR could
change its own copy.

## Limits

- The gate judges who wrote each comment. It doesn't judge the PR's own
  title, body or diff, or the issues it closes; an outsider's PR is outside
  text whatever its comments say.
- An inside bot that quotes outside text (a workflow echoing a PR title)
  passes that text on.
- A comment edited more than 20 times, and review comments past the first 50
  in a thread, are dropped and counted.

## Tests

```sh
bash orchestration/tests/trust-gate-cases.sh
```

A stand-in gh answers from `tests/fixtures/trust-gate/`; no case reaches
GitHub. Every outside body carries `MARKER-OUTSIDE`, and none may reach the
output.
