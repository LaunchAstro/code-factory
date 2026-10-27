## What changed

<!-- One paragraph. What this does, and why. Link the issue: Closes #123 -->

## How it was tested

<!--
The test that fails before this change and passes after it, by name.
Then anything you ran by hand, with what you saw.
"Tests pass" on its own is not a test plan.
-->

## Agent context

<!--
Fill this in if a model helped write this change. Required for
maintainer-directed agent work; expected as disclosure from anyone else.
See AI_POLICY.md.
-->

- Model and tool:
- What was asked for:
- What was generated:
- What the human checked, line by line or by sampling:

<!-- If no model was involved, write "None" and delete the bullets. -->

## Checklist

- [ ] At most 1,000 product lines (tests print and are not counted), or
      carrying a waiver label with its reason in a comment
- [ ] Every commit signed off (`git commit -s`); no sign-off added by a tool
- [ ] Checks green
- [ ] No client data, no real names, no fixture taken from a live system
- [ ] Documentation updated, or nothing needed updating

## Which layer should have caught this?

<!--
For each finding this pull request fixes, and for each one the review or the
checks raised in it: which layer should have caught it first, and did it?

Layers, cheapest first: the type checker, the linter, a test, a check in
continuous integration, a hook, a review, a person reading it later, a
customer.

**The answer becomes a check, not a note.** If the honest answer is "review
caught it and nothing else would have", say what check would have caught it
and either add it here or file it. A trap written down as a paragraph is a
trap that bites again; docs/TRAPS.md says the same thing and deletes its own
entries the day the check lands.

"Nothing could have caught this" is a legitimate answer. It is rare, and it
is worth writing down when it is true.
-->

- Finding →
- The layer that should have caught it →
- The check that now does, or the issue that will add it →

## For the maintainer

Nothing to tick. The decide step merges on the required contexts and the review
of record; a held pull request arrives with the reviewer's criterion findings
and waits for a decision. The one thing no check covers: if the diff touches
one of the eight components (domain model, tenancy wrapper, queue and delivery
contracts, gate engine, broker, egress control, sandbox launcher, migration
system), that component's conformance proof is a required context before merge.
No test, no merge.
