# Verify MilestoneFund

Current address, source hash and finalized deployment receipt are in [deployment.json](../deployment.json). Run `node scripts/verify-anchor.mjs` for independent read-only verification of the current deployed source, receipts and funds.

[Current live journal](../evidence/anchor-validation.json) demonstrates that rounds 2 and 3 remain bound to the original first-review snapshot hash and GitHub identity. Changing the original causes a round-two full stake refund and prevents round-three settlement. Restoring the reviewed content permits settlement. Final actual balance, credits and escrow are zero.

[Previous-version regression journal](../evidence/history/pre-anchor/paired-validation.json) preserves the earlier 17-transaction suite. It is not current-source evidence. Failed and retried fixture/restore calls remain in the current journal and receipt directory. [CI evidence](../evidence/ci-validation.json) distinguishes historical environment failures from successful browser recovery checks.
