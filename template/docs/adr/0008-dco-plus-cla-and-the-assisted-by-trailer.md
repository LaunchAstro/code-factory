# Separate provenance, human certification, and signatures

Accepted 6 September 2026; consolidated 8 September.

Commit attribution must identify how the change was authored. Agent-assisted
commits carry `Assisted-by: LLM`, the actual `Agent-model`, and the actual
`Agent-tool`. Human-only commits carry the human's own `Signed-off-by`.
An agent never writes a human certification. Missing model or tool evidence
must not be invented or supplied silently by a stale template.

Every project commit requires a cryptographic signature. The intended DCO app
configuration exempts verified signed organisation-member commits from its
sign-off requirement. That exemption does not remove repository provenance
requirements. Outside contributors certify the DCO themselves and complete
the CLA process when contributions open.

One kind of commit is exempt: the merge commit GitHub writes itself, of
which a long-lived branch has one per pull request it took in.
The ruleset requires merge commits, and GitHub writes them as "Merge pull
request #N from ..." with no trailers and no conventional type, so the two
rules cannot both hold over a whole history. `commit-range-check.mjs` grants
the exemption only when three things hold at once: the commit has exactly two
parents, which is what a pull-request merge has and an octopus merge has not;
its committer is the web-flow identity (`GitHub` or `web-flow` at
`noreply@github.com`), which is how GitHub writes a commit of its own, with a
person as the author; and it is already on the base's own history. The wording
is not one of the three, because anyone can type it.

The third condition is what the first two cannot supply. An identity in a
commit header is a claim, not proof of who wrote the commit: anyone can set
two environment variables. What a branch cannot do is put a commit onto the
protected branch's history, which the ruleset lets nothing but GitHub's own
merge do. So a merge commit a pull request introduces is checked like any
other commit, and only a commit that is already on the base is exempt. Proof
of origin rather than a claim would need GitHub's web-flow public key in the
verifying keyring and `%G?` reading `G`; those merge commits read `E` to a
local `git log --show-signature` today, because the key is not in the
allowed-signers file, while GitHub itself shows them verified.

The exemption covers those commits and nothing else: every commit a merge
brings in is still checked on its own. It is reached on one path only, because
a pull request's range never contains the merge commit that closes it and the
publication receipt refuses a candidate that is more than one root commit: the
`commit messages and provenance` job runs the whole history of `main`, with the
tip as its own base, on every push to it. Without that job nothing would run
the rule where the merges are, which is how a `main` whose every merge broke
the rule went unrefused.

These are separate controls. A signature does not identify the authoring
model, a model trailer does not certify a human's right to submit, and an
outside contribution agreement does not replace either. Hosted DCO behaviour
and signature recognition require live proof. [AI policy](../../AI_POLICY.md)
and [Contributing](../../CONTRIBUTING.md) define the procedure.
