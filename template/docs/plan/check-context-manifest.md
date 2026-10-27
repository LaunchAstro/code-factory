# Required-check context manifest

A ruleset preparation manifest carries `requiredChecks` as a non-empty array of
exact hosted context names. Each entry is a trimmed string and each name appears
once. A duplicate is invalid because two authored rows cannot represent two
independent hosted observations with the same name.

Run `node scripts/check-context-manifest.mjs MANIFEST.json` before using the
manifest. The command exits 1 for an unreadable manifest or any invalid entry.
