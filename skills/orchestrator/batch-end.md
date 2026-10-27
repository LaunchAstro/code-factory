# Batch end

- **Section end:** when a batch's last piece merges, brief one fresh lane per pass in [Section-end passes](../../docs/METHOD.md#section-end-passes), in order, each running `batch-cleanup` on that batch's merged code only; the cleanup PR takes the normal gate.
- **Stage end:** before the owner's test pack, start one review lane: Sol reads the whole merged stage at its exact head (the range form of [SOL-PROMPT.md](../code-factory/SOL-PROMPT.md)), builders fix, Sol approves the exact head. Building pauses until the owner tests and says OK; log `<UTC> ORCH NOTE stage <id> owner OK`.
