# MilestoneFund

Crowdfunding that only pays for proven work — backers fund the whole campaign up front with real testnet GEN, and GenLayer validators judge each milestone's evidence before a single unit moves.

**Live site:** https://xiaoyu7799.github.io/crowdfund-milestone-genlayer/

All money is real GEN on Stable Studionet (testnet GEN, free from the faucet at https://studio.genlayer.com/validators, zero cash cost). Amounts are wei integers (1 GEN = 10^18 wei); the site and the contract display both GEN and wei.

## Source and deployment version

The current source requires a **new deployment**. Existing `deployment.json`,
`evidence.json` and `evidence/live-verification.json` are preserved historical
records for the old contract; their source hash does not describe this revision.
The branch site sets `writesEnabled: false` until the new deployed source has
been verified. The production site remains the older release until published.
Local results are in [evidence/local-validation.json](evidence/local-validation.json).

## Historical deployed contract and evidence

- Contract: [0x4f1C46Af0C8A5aA853899459ca8bd3532a7f3Ad8](https://explorer-studio.genlayer.com/address/0x4f1C46Af0C8A5aA853899459ca8bd3532a7f3Ad8)
- Deployment: [0xf91eb9e89c3a8ffe33fea6075084399d2e24676ad2ace98677b87506b8dc193e](https://explorer-studio.genlayer.com/tx/0xf91eb9e89c3a8ffe33fea6075084399d2e24676ad2ace98677b87506b8dc193e), `FINALIZED`
- Historical deployed source SHA-256: `a43b6509e9684881a525dc88a5237150e7b4f7a91226080a6cb9babcd468ecf6` (recorded in the historical deployment manifest; not the updated source)
- [Evidence index](evidence.json), [deployment manifest](deployment.json), [live verification](evidence/live-verification.json), [reviewer fast path](docs/reviewer-fast-path.md)

## How it works

1. **Fund.** Anyone backs a campaign with real GEN: `back_campaign` is payable, and the GEN sent with the call is held in escrow. Backing is capped at the goal; at full funding the campaign moves to `MILESTONE_REVIEW` and milestones open. Get GEN free from the faucet first.
2. **Prove.** The creator submits evidence for a milestone: free text, the date the evidence is from, and a reference URL. The text is never judged — it only identifies the claim.
3. **Judge.** A backer reviews the milestone. The leader and every validator independently fetch the reference URL and judge only the fetched snapshot against three strict binary criteria (a concrete deliverable matching the milestone named, completion described, independently checkable detail about this milestone). The contract — not the LLM — turns the flags into the verdict: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 → `REJECT`. For GitHub file URLs the validators also check the file against the GitHub API contents endpoint and record its blob SHA. The judge must quote one sentence character for character from the snapshot.
4. **Challenge or confirm.** An independent backer may confirm from the next UTC day. A 1 GEN challenge fetches original and counter-evidence together. Validators must agree that the counter page contains concrete corrective facts about the same deliverable, rather than unrelated material or mere corroboration. A non-rebuttal refunds the stake without changing the milestone. A valid rebuttal leaving the verdict unchanged settles and forfeits the stake. A changed verdict freezes the milestone, returns the stake and awards at most `min(0.5 GEN, milestone allocation, available campaign escrow)`, rounded down to even wei. The third review compares both references again and settles the remaining pool. Both hashes and original quotation are recorded. Creators cannot back or review their own campaigns; a sole independent backer can resolve a dispute.
5. **Settle, then withdraw.** `ACCEPT` credits the full milestone amount to the creator, `REJECT` credits it pro-rata to backers, `PARTIAL` credits half each way. Milestone amounts are positive even wei, so the split is exact. Settlement only records credits — each beneficiary pulls their own GEN out with `withdraw_payout`, which zeroes the credit before transferring. A settled verdict is immutable.

Consensus is over the verdict, not the raw flags: a validator accepts a leader result only if the evidence hash, the current UTC date, the reference URL, the snapshot hash and length, the GitHub blob SHA, and the verdict derived from the leader's flags all equal its own independent values exactly, and the leader's quote appears verbatim in its own snapshot. Two validators may disagree on one diagnostic flag while agreeing on the verdict — the recorded flags are the settling leader's, but the verdict and the money are the same either way, so the worst-case spread is 0 in verdict and 0 GEN. A split that changes the verdict cannot settle at all: the milestone stays open and retryable, never paid out on a coin flip. Evidence older than 30 days (or future-dated) cannot be reviewed at all. See [docs/mechanism.md](docs/mechanism.md) for the full calculation.

Standing is history, not a score: the contract records total GEN ever backed, milestones completed as a backer, campaigns created, milestones released as a creator, and challenges won and lost. There is no starting reputation and no points; nothing is gated on standing.

## Historical live run (old contract, not updated-source validation)

Three campaigns on the deployed contract. All 39 business transactions `FINALIZED` (plus the deployment transaction and 4 faucet fundings); 8 failed-call probes (stranger review, three bad confirms, wrong-stake challenge, over-goal backing, failed-adjudication challenge, funded-campaign backing) are recorded in [evidence.json](evidence.json) with their `FINALIZED` receipts.

### Campaign `0`, "Riverside Community Garden sensor network", goal 20 GEN, funded 12 GEN + 8 GEN by two backers

| Milestone | Amount | Flags | Verdict | Released | Refunded |
| --- | --- | --- | --- | --- | --- |
| Sensor kits assembled | 8 GEN | true, true, true | ACCEPT | 9 GEN | 0 |
| Dashboard live | 8 GEN | false, false, false | REJECT | 0 | 8 GEN (4.8 / 3.2) |
| Field report published | 4 GEN | true, true, false | PARTIAL | 2 GEN | 2 GEN (1.2 / 0.8) |

Milestone 0 was challenged with a 1 GEN stake; the second review agreed (`ACCEPT`), so the challenge failed, the verdict settled, and the 1 GEN stake was forfeited into the milestone's allocation — the 8 GEN pool became 9 GEN, all to the creator. Milestone 1's reference was `https://example.org` and its evidence text carried a prompt-injection probe; the fetched snapshot is the placeholder page, all three flags false, 0 released.

### Campaign `1`, "Riverside Garden sensor network, second run", goal 8 GEN, funded 5 GEN + 3 GEN

| Milestone | Amount | Round-1 flags | Final verdict | Released | Refunded |
| --- | --- | --- | --- | --- | --- |
| Sensor kits assembled | 4 GEN | false, false, false | ACCEPT | 3.5 GEN | 0 |
| Dashboard live | 4 GEN | false, true, false | REJECT | 0 | 4 GEN (2.5 / 1.5) |

Milestone 0 round 1 was `REJECT` (reference `https://example.org`). Backer C challenged with the sensor-kits delivery file as counter-evidence; round 2 returned `ACCEPT`, disagreeing with round 1, so the milestone froze, the 1 GEN stake returned plus a 0.5 GEN reward, and backer B resolved it — round 3 returned `ACCEPT` and the 3.5 GEN pool went to the creator. All three evaluations are kept on chain as witness. Milestone 1's reference was the sensor-kits delivery file — a real page about the wrong milestone. It took 4 review attempts to converge (validators split across the verdict boundary in the first 3 rounds); the settling flags were `false, true, false` with the rationale that the snapshot shows completed sensor-kit installation, not a named dashboard deliverable.

### Campaign `2`, goal 10 GEN, backed 4 GEN and never funded

The creator cancelled it; backer B was credited the 4 GEN back.

### Totals

Final credits: creator 14.5 GEN, backer B 22.5 GEN, backer C 8 GEN, stranger D 0. All withdrew in full: creator EOA 10,000 → 10,014.5 GEN, backer B 9,969 → 9,991.5 GEN, backer C 9,986 → 9,994 GEN, stranger D 10,000 → 10,000 GEN. Contract balance 0, credits 0, escrow 0. Total received 45 GEN (32 backed + 2 challenge stakes + 11 refunded invalid payments) equals total withdrawn 45 GEN. Every transaction hash is in [evidence.json](evidence.json).

## Usage

### Site

Reads need no signer. Browser writes use a recoverable test signer: choose a
password of at least 12 characters, then export the encrypted JSON backup.
Reload the page and use the same password to unlock the saved signer, or import
the backup in another browser. The displayed full address identifies the actual
writer. Passwords are not stored; losing both the browser storage and backup,
or losing the password, prevents recovery. The injected wallet remains a read
identity. Keep backups private; browser compromise can expose an unlocked signer.
The updated branch deliberately blocks writes to the historical contract.

### Contract (scripts)

Requires Node 20+ and the `genlayer-js` dependency (`npm install`).

```sh
# Deploy a fresh contract to Stable Studionet (ephemeral deployer key)
node scripts/deploy.mjs --check
# After explicit transaction authorization only:
# node scripts/deploy.mjs --submit

# Historical flow; guarded against updated source / old deployment mismatch
node scripts/flow.mjs

# Read back live state and compare it against evidence.json
node scripts/verify.mjs

# Local mock tests (pure functions + lifecycle money math, not on-chain)
npm test
```

## Repository layout

- `contracts/milestone_fund.py` — the GenLayer contract
- `docs/` — the site (`index.html`, `styles.css`, `config.js`, `app.bundle.js`) and the mechanism + reviewer docs
- `site/src/` — the site source (`app.js`, `i18n.js`); bundled with esbuild via `node scripts/build_site.mjs`
- `scripts/` — deploy, flow, verify, site build, i18n parity check
- `tests/` — local mock tests
- `evidence.json`, `evidence/live-verification.json`, `deployment.json` — the evidence pack
- `KNOWN_LIMITATIONS.md` — the real limits, in neutral wording
