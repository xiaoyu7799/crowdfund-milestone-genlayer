# Verify MilestoneFund

The current address, deployment transaction and source hash are in [deployment.json](../deployment.json). Deployed source is compared byte for byte by `node scripts/verify-paired.mjs`.

[Live validation](../evidence/paired-validation.json) records 17 checked transactions and 33 assertions, including creator review refusal, three non-rebuttal refunds, paired disputes, 2 wei and 0.5 GEN reward limits, sole-backer resolution and withdrawals. Expected negative calls are distinguished from successful business operations.

[Independent readback](../evidence/live-verification.json) checks current deployed code, final receipts and settled state. Actual contract balance, outstanding credits and locked escrow are zero. Two quote-rejected corrective attempts refunded full stakes and remain in failedAttempts. [Historical records](../evidence/history/) preserve the earlier consensus-disagreed call and platform-retained surplus.

[Browser CI](../evidence/ci-validation.json) records signer recovery tests and the earlier runner incompatibility. Local mock tests are not chain evidence.
