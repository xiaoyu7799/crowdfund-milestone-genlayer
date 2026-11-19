# MilestoneFund — Two-stage challenge escrow

The GenLayer-accepted baseline is commit [f2c6647](https://github.com/xiaoyu7799/crowdfund-milestone-genlayer/tree/f2c6647a81f5b179ad5d222eb01340e8a45925fb), deployed at [0xF49D…A692](https://explorer-studio.genlayer.com/address/0xF49D710b0bBB23058D2ED08d141b2E28a4a9A692). Its challenge combined payment, web fetching and adjudication in one transaction. An earlier deployment recorded a consensus failure with 1 GEN in the chain balance but no matching ledger entry. See the baseline's known limitations and historical receipt archive.

## What changed

1. An eligible backer files one challenge per pending milestone, before the end of the initial review's UTC day. The 1 GEN deposit and evidence reference are recorded in a deterministic transaction with no network access. The new escrow appears in `get_totals.challenge_stakes_locked_wei`.
2. Anyone can request a zero-value review using the filed challenge ID. This preserves the existing paired-evidence and original snapshot checks. A failed adjudication leaves the same stake and evidence pending for retry. Evidence that is evaluated and found ineligible credits the challenger in full.
3. A filed challenge blocks ordinary confirmation. After 24 hours from filing, anyone can release the pending stake as withdrawable credit to the original challenger. Review and expiry have disjoint time windows. The challenger withdraws the credit with the existing payout method. Unique challenge IDs prevent a stale review or refund request from acting on a later filing.
4. The browser shows the recorded stake, UTC expiry and the available review or refund action. The exported audit dossier includes pending stakes in the ledger totals.

The actual contract balance is checked against campaign escrow, pending challenge stakes and withdrawable credits. A project may be held open for up to 24 hours by a filed challenge. Expiry is settled by a transaction. Pending funds on historical deployments remain governed by their original contracts. The [accepted-deployment view](https://xiaoyu7799.github.io/crowdfund-milestone-genlayer/?version=accepted) preserves access to earlier campaigns and withdrawals.

## Verification

- [New deployment and source hash](../evidence/two-stage/deployment.json)
- [New deployment receipt](../evidence/two-stage/deployment-receipt.json)
- Run `npm test` for mocked consensus disagreement, same-stake retry, deadline boundaries, permissionless expiry, duplicate refund prevention, withdrawal and actual-balance reconciliation.
- Run `node scripts/two-stage-flow.mjs` for the live validation plan. With funded test accounts provided through an external `MF_RECOVERY_FILE`, pass `--submit` to run or resume the Stable Studionet journal. The journal records zero-value adjudication, payouts and independent RPC balance checks. Its `complete` flag is set only after the on-chain expiry and withdrawals finish.

## Submission note

MilestoneFund now records challenge deposits before evidence review. GenLayer validators assess the original delivery and the rebuttal in a separate, zero-value transaction. A failed review can be retried using the same deposit, or the challenger can recover it after expiry. The upgrade adds on-chain challenge state, a stake ledger reconciled against the chain balance, and a browser workflow for reviewing and refunding pending challenges.
