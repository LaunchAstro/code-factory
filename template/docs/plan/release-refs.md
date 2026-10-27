# Release branch references

Release automation accepts a fully qualified Git reference in the exact form
`refs/heads/release/YYYY-MM-DD`. The `refs`, `heads` and `release` segments are
lower-case, and the date must be a real calendar day.

Run `node scripts/release-ref.mjs <ref>` before using a supplied release branch
in an API request. Exit 0 means the reference is valid, exit 1 means it is not,
and exit 2 means the command invocation is incomplete.
