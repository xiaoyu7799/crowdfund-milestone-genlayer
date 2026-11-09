# MilestoneFund

Crowdfunding that only pays for proven work — backers fund the whole campaign up front with real testnet GEN, and GenLayer validators judge each milestone's evidence before a single unit moves.

**Live site:** https://xiaoyu7799.github.io/crowdfund-milestone-genlayer/

All money is real GEN on Stable Studionet (testnet GEN, free from the faucet at https://studio.genlayer.com/validators, zero cash cost). Amounts are wei integers (1 GEN = 10^18 wei); the site and the contract display both GEN and wei.

## Deployed contract and evidence

- Contract: [0x2151db0CD7259A9D714C4431335f98E860f72F86](https://explorer-studio.genlayer.com/address/0x2151db0CD7259A9D714C4431335f98E860f72F86)
- Deployment: [0xd182de0fed50e37d4b6880709057a019c1523748163157a566ec4e19dc79d806](https://explorer-studio.genlayer.com/tx/0xd182de0fed50e37d4b6880709057a019c1523748163157a566ec4e19dc79d806), `FINALIZED`
- Contract source SHA-256: `e7dab0dbb6b9a367669df5bb4f0a39943a47ffbf367ec02bc2e965ca31f49ba2` (`contracts/milestone_fund.py`; the deployment read-back via `gen_getContractCode` decodes to the same hash)
- [Evidence index](evidence.json), [deployment manifest](deployment.json), [live verification](evidence/live-verification.json), [reviewer fast path](docs/reviewer-fast-path.md)

## How it works

1. **Fund.** Anyone backs a campaign with real GEN: `back_campaign` is payable, and the GEN sent with the call is held in escrow. Backing is capped at the goal; at full funding the campaign moves to `MILESTONE_REVIEW` and milestones open. Get GEN free from the faucet first.
2. **Prove.** The creator submits evidence for a milestone: free text plus the date the evidence is from.
3. **Judge.** Anyone reviews the milestone. The leader and every validator independently fetch the current UTC date and judge the evidence against three strict binary criteria (a concrete deliverable named, a checkable reference present, completion described). The contract — not the LLM — turns the three agreed flags into the verdict: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 → `REJECT`.
4. **Challenge or confirm.** The first review leaves a pending verdict. Anyone may confirm it, or anyone except the creator may challenge it first by sending exactly 1 GEN. A challenge runs a second independent review: agreement settles the verdict and the 1 GEN stake is forfeited into the milestone's allocation; disagreement freezes the milestone with both verdicts kept as witness, the stake returns plus a 0.5 GEN reward from escrow, and a third review decides the tie-break.
5. **Settle, then withdraw.** `ACCEPT` credits the full milestone amount to the creator, `REJECT` credits it pro-rata to backers, `PARTIAL` credits half each way. Milestone amounts are positive even wei, so the split is exact. Settlement only records credits — each beneficiary pulls their own GEN out with `withdraw_payout`, which zeroes the credit before transferring. A settled verdict is immutable.

The verdict is pinned by exact agreement: a validator accepts a leader result only if the evidence hash, the current UTC date, and all three criterion flags equal its own independent values exactly. Two leader outputs that both pass validation therefore carry the same flags, the same verdict, and the same money movement — the worst-case spread is exactly zero. Evidence older than 30 days (or future-dated) cannot be reviewed at all. See [docs/mechanism.md](docs/mechanism.md) for the full calculation.

Standing is history, not a score: the contract records total GEN ever backed, milestones completed as a backer, campaigns created, milestones released as a creator, and challenges won and lost. There is no starting reputation and no points; nothing is gated on standing.

## Live run (campaign 0)

Campaign `0`, "Riverside Community Garden sensor network", goal 100 GEN, funded 60 GEN + 40 GEN by two backers. All 15 business transactions `FINALIZED` (plus the deployment transaction and 3 faucet fundings):

| Milestone | Amount | Flags | Verdict | Released | Refunded |
| --- | --- | --- | --- | --- | --- |
| Sensor kits assembled | 40 GEN | true, true, true | ACCEPT | 40 GEN | 0 |
| Dashboard live | 40 GEN | false, false, false | REJECT | 0 | 40 GEN (24 / 16) |
| Field report published | 20 GEN | true, false, true | PARTIAL | 10.5 GEN | 10.5 GEN (6.3 / 4.2) |

Milestone 2 was challenged with a 1 GEN stake; the second review agreed (`PARTIAL`), so the challenge failed, the verdict settled, and the 1 GEN stake was forfeited into the milestone's allocation — the 20 GEN pool became 21 GEN, split 10.5 / 10.5. Final credits: creator 50.5 GEN, backer B 30.3 GEN, backer C 20.2 GEN. All three withdrew in full: creator EOA 10,000 → 10,050.5 GEN, backer B 9,939 → 9,969.3 GEN, backer C 9,960 → 9,980.2 GEN. Contract balance 0, credits 0, escrow 0. Total received 101 GEN (100 backed + 1 stake) equals total withdrawn 101 GEN. Every transaction hash is in [evidence.json](evidence.json).

## Usage

### Site

Open the live site, connect any injected EVM wallet (OKX first) to read as yourself, or just read without a wallet. To write, enable the clearly labelled in-browser temporary test account (its key never leaves your browser) and fund it from the faucet first; then back a campaign (GEN is sent with the call, shown in GEN and wei), submit evidence, review, challenge, confirm, or withdraw. Each action shows its transaction status and explorer link, and reads the result back from the chain.

### Contract (scripts)

Requires Node 20+ and the `genlayer-js` dependency (`npm install`).

```sh
# Deploy a fresh contract to Stable Studionet (ephemeral deployer key)
node scripts/deploy.mjs

# Run the full business flow against the deployed contract
node scripts/flow.mjs

# Read back live state and compare it against evidence.json
node scripts/verify.mjs

# Local mock tests (pure functions + lifecycle money math, not on-chain)
python3 tests/local_tests.py
```

## Repository layout

- `contracts/milestone_fund.py` — the GenLayer contract
- `docs/` — the site (`index.html`, `styles.css`, `config.js`, `app.bundle.js`) and the mechanism + reviewer docs
- `site/src/` — the site source (`app.js`, `i18n.js`); bundled with esbuild via `node scripts/build_site.mjs`
- `scripts/` — deploy, flow, verify, site build, i18n parity check
- `tests/` — local mock tests
- `evidence.json`, `evidence/live-verification.json`, `deployment.json` — the evidence pack
- `KNOWN_LIMITATIONS.md` — the real limits, in neutral wording
