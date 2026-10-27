# Issue tracker

GitHub Issues is the intended tracker for this repository. One active ticket
has one owner and one isolated branch. The ticket names its specification,
acceptance criteria, dependencies, and required evidence.

Before the hosted tracker is established, explicitly authorised foundation
work uses its written local specification and handoff. That local record does
not create an issue, reserve product work, or grant publication authority.

When the remote exists, configure the tracker through the repository's Matt
Pocock setup workflow and verify the resulting settings. Outside issue and
pull request creation remain closed until the maintainer changes that policy.

Report unrelated discoveries separately. Keep implementation, necessary
corrections, and evidence together in useful deliverables; routine status
updates do not need their own pull requests.

Every spec and ticket body, and every pull request description, carries a
`Section: <id>` line naming the work map section it belongs to (the IDs in
the project's work map), or `Section: outside` for work on
no map. A ticket without one inherits its parent's. The route from idea to
merged is Code Factory's: `wayfinder`, `to-spec`, `to-tickets`, then the
build.
