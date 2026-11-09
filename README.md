# MilestoneFund

Crowdfunding that only pays for proven work — backers fund the whole campaign up front, and GenLayer validators judge each milestone's evidence before a single unit moves.

**Live site:** https://xiaoyu7799.github.io/crowdfund-milestone-genlayer/

All mGEN are simulated ledger units on Stable Studionet. No real cryptocurrency is transferred, held, or custodied.

## Deployed contract and evidence

- Contract: [0x23667D800Be2A8cf97445134Fea1691387F10f3E](https://explorer-studio.genlayer.com/address/0x23667D800Be2A8cf97445134Fea1691387F10f3E)
- Deployment: [0xd22a9ab292f5b6c77c792f1c7bac39add13fc15cd65c705a0aabb00b755588c4](https://explorer-studio.genlayer.com/tx/0xd22a9ab292f5b6c77c792f1c7bac39add13fc15cd65c705a0aabb00b755588c4), `FINALIZED`, `MAJORITY_AGREE`
- Contract source SHA-256: `3972276b602963ae8ccddd297984cfc5c78d6e8bdb2e52fc98024482a88c4bf4` (`contracts/milestone_fund.py`; the deployment transaction's embedded code decodes to the same hash)
- [Evidence index](evidence.json), [deployment manifest](deployment.json), [live verification](evidence/live-verification.json), [reviewer fast path](docs/reviewer-fast-path.md)

## How it works

1. **Fund.** Anyone claims 10,000 simulated mGEN once (`claim_demo_funds`) and backs a campaign. Backing is capped at the goal; at full funding the campaign is `FUNDED` and milestones open.
2. **Prove.** The creator submits evidence for a milestone: free text plus the date the evidence is from.
3. **Judge.** Anyone evaluates the milestone. The leader and every validator independently fetch the current UTC date and judge the evidence against three strict binary criteria (a concrete deliverable named, a checkable reference present, completion described). The contract — not the LLM — turns the three agreed flags into the verdict: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 → `REJECT`.
4. **Challenge or finalize.** The first evaluation leaves a pending verdict. Anyone may finalize it, or anyone except the creator may challenge it first. A challenge runs a second independent evaluation: agreement finalizes the verdict (challenger −5 reputation, 50 mGEN of the 100 mGEN bond goes to backers); disagreement freezes the milestone with both verdicts kept as witness, and a third evaluation decides the tie-break.
5. **Settle.** `ACCEPT` releases the full milestone amount to the creator, `REJECT` refunds it pro-rata to backers, `PARTIAL` releases half and refunds half. Milestone amounts are positive even integers, so the split is exact. A finalized verdict is immutable.

The verdict is pinned by exact agreement: a validator accepts a leader result only if the evidence hash, the current UTC date, and all three criterion flags equal its own independent values exactly. Two leader outputs that both pass validation therefore carry the same flags, the same verdict, and the same money movement — the worst-case spread is exactly zero. Evidence older than 30 days (or future-dated) cannot be evaluated at all. See [docs/mechanism.md](docs/mechanism.md) for the full calculation.

## Live run (campaign 0)

Campaign `0`, "Riverside Community Garden sensor network", goal 10,000 mGEN, funded 6,000 + 4,000 by two backers. All 15 business transactions `FINALIZED` (plus the deployment transaction):

| Milestone | Amount | Flags | Verdict | Released | Refunded |
| --- | --- | --- | --- | --- | --- |
| Sensor kits assembled | 4,000 | true, true, true | ACCEPT | 4,000 | 0 |
| Dashboard live | 4,000 | false, false, false | REJECT | 0 | 4,000 (2,400 / 1,600) |
| Field report published | 2,000 | true, false, true | PARTIAL | 1,000 | 1,000 |

Milestone 2 was challenged; the second evaluation agreed (`PARTIAL`), so the challenge failed, the verdict finalized, the challenger lost 5 reputation (100 → 95) and 50 mGEN of the bond went to backers. Final balances: creator 15,000, backer B 6,980, backer C 8,020; escrow 0. Balances plus escrow sum to 30,000 — exactly the three demo-fund claims. Every transaction hash is in [evidence.json](evidence.json).

## Usage

### Site

Open the live site, connect any injected EVM wallet (OKX first) to read as yourself, or just read without a wallet. To write, enable the clearly labelled in-browser temporary test account (its key never leaves your browser); then claim demo funds, back a campaign, submit evidence, evaluate, challenge, or finalize. Each action shows its transaction status and explorer link, and reads the result back from the chain.

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
