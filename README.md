# MilestoneFund

**Live site:** https://xiaoyu7799.github.io/crowdfund-milestone-genlayer/

Crowdfunding with testnet GEN held in escrow until GenLayer validators review each milestone. ACCEPT credits the creator, REJECT refunds backers pro rata, and PARTIAL splits the allocation. Beneficiaries withdraw their own credits.

## Contract and verification

- Stable Studionet, chain 61999, RPC https://studio.genlayer.com/api
- Contract: https://explorer-studio.genlayer.com/address/0x2dd504b10b2a11A7c4106a7c72662B97fDB78591
- Deployment: https://explorer-studio.genlayer.com/tx/0x894d491d3db2bf30d4ecd90a651d6f7346cc79f4a54baacef25318ad85c14780
- Deployment status: FINALIZED, execution SUCCESS, consensus MAJORITY_AGREE.
- Source SHA-256: `44274544a3f9f7ed9451ff1bb2078f84611c0b519b8a01a10566a75dbf110c1c`; deployed code readback matches byte for byte.
- [Evidence index](evidence.json), [live journal](evidence/paired-validation.json), [independent readback](evidence/live-verification.json), [browser CI](evidence/ci-validation.json).

## Challenge mechanism

Challenge and dispute resolution fetch original and counter-evidence together. Validators independently check both snapshot hashes, GitHub identities, quotations and rebuttal eligibility. Unrelated pages, corroboration without rebuttal, and repeated original snapshots return the entire stake as withdrawable credit without changing the milestone. Non-rebuttal delivery scores do not affect state or payments; valid rebuttals still require exact verdict agreement.

A changed verdict freezes the milestone. The challenger receives the 1 GEN stake back plus a reward capped at the minimum of 0.5 GEN, the milestone allocation and available escrow, rounded down to even wei. A third paired review settles the remaining pool. Creators cannot back or review their own campaign. A sole independent backer can resolve a dispute.

## Live regression coverage

The current deployment completed 17 checked transactions, including expected creator-review rejection. Controlled test documents exercise the real network's fetching and consensus; they are not real-world delivery claims.

The 2 wei milestone paid only a 2 wei reward and left the separate 2 GEN milestone unchanged. Both disputes were resolved by the sole independent backer. The 2 GEN milestone reward was 0.5 GEN. Creator and backer withdrew their credits. Final actual contract balance, outstanding credits and locked escrow are all zero.

Two initial corrective-evidence attempts failed strict verbatim quotation checks and refunded their entire stakes. Their receipts remain in the live journal's `failedAttempts`. Corrective documents now use contiguous sentences; quotation verification remains strict.

## Recoverable signer

Browser writes use a password-encrypted test signer stored locally, with encrypted export/import. Keep the backup and password to restore the same address after a refresh or in another browser. The full writer address is displayed. The injected wallet remains a read identity. Browser CI verifies creation, export, reload/unlock and import after clearing storage, with RPC blocked.

## Reproduce

```sh
npm ci --ignore-scripts
npm test
npm run build-site
npm run i18n
node scripts/verify-paired.mjs
node scripts/paired-flow.mjs --plan
```

Local tests mock GenVM; only the recorded live receipts and readbacks are on-chain evidence. Live writes require persistent signers outside the repository and explicit `--submit`. Historical deployment records, failed consensus and balances remain in [evidence/history](evidence/history/). See [mechanism](docs/mechanism.md), [security regressions](docs/security-regressions.md), and [known limitations](KNOWN_LIMITATIONS.md).
