<!--
The merge script reads the lines below, outside any comment, before it
merges (orchestration/enqueue.md, "The loading bay's gates" and "With no
merge queue"). Replace each TODO; a TODO left in waits with
`gate=description`, `gate=section` or `gate=risk`. The shape, as enqueue.md
shows it:

**Why:** the reasons for the choices in this code
**Left undone:** #12, your-org/work-map#40
Closes #7, closes your-org/work-map#8
Section: checks

`Left undone: none` and `Closes: none` are allowed. This repository has no
merge queue, so it also needs `**Risk:** low`, `medium` or `high` with its
reason.
-->

**Why:** TODO
**Left undone:** TODO
Closes: TODO
Section: TODO
**Risk:** TODO

## What changed

<!-- One paragraph. What this does, and why. -->

## Review outcomes

<!--
An outcome, not a mention: "not run", "pending", "skipped", "failed" and open
findings are all a no.
-->

Sol's review: <!-- review id, verdict, head sha -->

## How it was tested

<!--
What you ran and what you saw. A change under `template/` is proved from a
scratch copy: `git init`, one commit, `corepack pnpm install`, then
`corepack pnpm check`. Give the step count and the time.
"Tests pass" on its own is not a test plan.
-->

## Agent context

<!--
Fill this in if a model helped write this change. Required for
maintainer-directed agent work; expected as disclosure from anyone else.
-->

- Model and tool:
- What was asked for:
- What was generated:
- What the human checked, line by line or by sampling:

<!-- If no model was involved, write "None" and delete the bullets. -->

## Checklist

- [ ] Every commit signed (`git commit -S`) and signed off (`git commit -s`);
      no sign-off added by a tool
- [ ] `corepack pnpm check` green from a scratch copy of `template/`, if this
      touches `template/`
- [ ] `gitleaks detect --source . --no-git` clean
- [ ] No client data, no real names, no fixture taken from a live system
- [ ] `docs/rounds/` untouched: it is the dated record of what the rounds
      proved
- [ ] Documentation updated, or nothing needed updating

## Which layer should have caught this?

<!--
For each finding this pull request fixes, and for each one the review raised
in it: which layer should have caught it first, and did it?

Layers, cheapest first: the type checker, the linter, a test, a check in
continuous integration, a hook, a review, a person reading it later, a
customer.

**The answer becomes a check, not a note.** If the honest answer is "review
caught it and nothing else would have", say what check would have caught it
and either add it here or file it.

"Nothing could have caught this" is a legitimate answer. It is rare, and it
is worth writing down when it is true.
-->

- Finding →
- The layer that should have caught it →
- The check that now does, or the issue that will add it →

## For the maintainer

- [ ] The claim in the pull request body reproduces
- [ ] Sol's verdict is on this head
- [ ] Review findings closed
- [ ] Which layer should have caught this, answered above, and the answer has
      become a check or a filed issue
