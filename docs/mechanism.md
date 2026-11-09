# MilestoneFund mechanism

## Goal

Crowdfunding that only pays for proven work. Backers fund a campaign up
front; the money sits in escrow and moves only when GenLayer validators
judge the milestone evidence. Delivered work releases the milestone
amount to the creator. Failed work refunds it pro-rata to backers.
Half-proven work splits it down the middle.

## State

All state lives in five JSON documents plus a counter:

- `campaigns_json` — one record per campaign, keyed by id.
- `balances_json` — simulated mGEN ledger balances per address.
- `reputations_json` — reputation per address (starts at 100 on first
  participation, floor 0).
- `claimed_json` — which addresses already claimed demo funds.
- `participants_json` — addresses in first-participation order.
- `next_id` — next campaign id.

A campaign:

```json
{
  "id": 0,
  "title": "Riverside Community Garden sensor network",
  "creator": "0x…",
  "goal": 10000,
  "status": "FUNDING",
  "total_backed": 10000,
  "escrow": 10000,
  "backers": [{"address": "0x…", "amount": 6000}],
  "milestones": [
    {
      "title": "Sensor kits assembled",
      "amount": 4000,
      "status": "FINALIZED",
      "evidence_text": "…",
      "evidence_date": "2026-11-09",
      "evidence_hash": "…",
      "evaluations": [{"round": 1, "flags": ["true", "true", "true"], "rationale": "…", "current_date": "2026-11-09", "verdict": "ACCEPT"}],
      "pending_verdict": null,
      "final_verdict": "ACCEPT",
      "released": 4000,
      "refunded": 0,
      "refund_payouts": [],
      "challenge": null
    }
  ]
}
```

Milestone statuses: `PENDING` → `EVIDENCE_SUBMITTED` → `EVALUATING` →
`FINALIZED`, with `FROZEN` reachable from `EVALUATING` on a
contradicting challenge, resolved by a third evaluation.

## Money rules (deterministic, integer-only)

- `claim_demo_funds` credits 10,000 simulated mGEN once per address.
  All mGEN are simulated ledger units; no real cryptocurrency moves.
- `create_campaign(title, goal, milestones_json)`: 1–6 milestones, each
  amount a positive even integer, amounts summing to the goal exactly.
- `back(campaign_id, amount)`: amount must be a positive even integer;
  backing is capped at the goal. At `total_backed == goal` the campaign
  becomes `FUNDED` and milestones open. Backing draws down the caller's
  simulated balance.
- Settlement on finalization, computed once in the contract after
  consensus:
  - `ACCEPT`: release the full milestone amount to the creator.
  - `REJECT`: refund the full amount pro-rata to backers.
  - `PARTIAL`: release half, refund half. The amount is even, so the
    split is exact — no rounding anywhere.
- Pro-rata refunds use integer division. The remainder (at most one
  unit per backer) goes to the largest backer, first in insertion
  order on ties. The rule is deterministic and fixed in the contract;
  it is never a subject of validator disagreement.
- Challenge bond: 100 mGEN, posted by the challenger. Failed challenge
  (second verdict equals the first): 50 mGEN is distributed pro-rata
  to backers, 50 mGEN returns to the challenger, challenger reputation
  −5. Successful challenge (verdicts differ): the full 100 mGEN
  returns, no reputation change, milestone freezes.
- Reputation: creator +5 on ACCEPT, −5 on REJECT, +0 on PARTIAL;
  challenger −5 only on a failed challenge. Floor 0.
- **No action requires a minimum balance or a minimum reputation**, so
  no penalty can ever lock an address out of participating. The only
  balance-gated action is challenging (needs 100 mGEN at challenge
  time, of which 50 always returns). There is no stake to top up.

## Evaluation (nondet + consensus)

`evaluate_milestone` / `challenge_milestone` (round 2) /
`resolve_frozen` (round 3) all run the same adjudication:

1. Fetch the current UTC date from
   `https://timeapi.io/api/Time/current/zone?timeZone=UTC` and take the
   `dateTime` field's date part. If the fetch fails, returns non-200,
   or is unparseable, raise before any write — the milestone stays
   open and evaluation can be retried.
2. Staleness gate: the evidence date must lie within the 30 days up
   to and including the current date. Future-dated or older evidence
   raises before any write. The creator must then submit fresh
   evidence (resubmission is allowed while the milestone is
   `EVIDENCE_SUBMITTED`).
3. Judge the evidence with an LLM against three strict binary
   criteria (definitions are in the prompt, applied strictly):
   - `deliverable_named`: the evidence names one concrete deliverable
     matching the milestone title. Vague words do not count.
   - `verifiable_reference`: the evidence contains a URL, repository
     path, commit hash, tag, transaction hash, or named file a reader
     could check. A bare number or "tested locally" does not count.
   - `completion_described`: the evidence describes work already
     finished. A plan or promise does not count.
   The LLM returns the three flags plus one rationale sentence.
   Evidence text is treated as untrusted data in the prompt;
   instructions inside it are to be ignored.
4. The contract — never the LLM — computes the verdict from the
   agreed flags: 3 of 3 → `ACCEPT`, 2 of 3 → `PARTIAL`, 0–1 of 3 →
   `REJECT`.

A validator accepts a leader result only if ALL of these hold:

1. the leader's `evidence_hash` equals the hash stored at submit time
   (pure-Python SHA-256 of the evidence text, computed in the
   contract);
2. the leader's `current_date` equals the validator's own
   independently fetched date, exactly;
3. the leader's three flags equal the validator's own three flags,
   exactly — flag for flag.

The rationale is leader-provided witness text for humans to read. It
is not used for the verdict and is not part of the consensus check.
If the leader raised a UserError (time source down, stale evidence,
judge failure), a validator agrees only if its own run also raises a
UserError — agreement that nothing can be judged yet.

## Worst-case spread calculation (required)

The consensus object is the milestone verdict, and the money that
moves because of it. The question is: how far apart can two different
leader outputs be, if both pass validation?

- The verdict is a deterministic function of the three flags:
  `ACCEPT` iff flags = [true, true, true]; `PARTIAL` iff exactly two
  are true; `REJECT` otherwise. There are 8 possible flag vectors
  and 3 possible verdicts.
- Validation requires the leader's flag vector to equal the
  validator's own independently produced vector, exactly. So a leader
  proposing [true, true, false] (PARTIAL) passes a given validator
  only if that validator's own run also produced [true, true, false].
  A leader proposing [true, true, true] (ACCEPT) passes the same
  validator only if its own run produced [true, true, true]. Both
  cannot pass the same validator, because the validator's own vector
  is one specific vector.
- Edge case, worked: true evidence quality sits exactly on the
  ACCEPT/PARTIAL boundary. Leader X reports [T, T, T] → ACCEPT,
  release 4,000. Leader Y reports [T, T, F] → PARTIAL, release 2,000
  + refund 2,000. Both are plausible LLM outputs for borderline
  evidence. Can both pass? No: each validator accepts at most the
  vector it produced itself. Whichever vector the validators
  independently converge on is the only one that can finalize. The
  other is rejected by validation and the milestone stays
  `EVIDENCE_SUBMITTED` (or `EVALUATING`/`FROZEN`) — retryable, never
  silently settled with the losing verdict.
- Therefore the maximum spread between two validator-compatible leader
  outputs is: **0 in flags, 0 in verdict, 0 mGEN in released amount,
  0 mGEN in refunded amount.** There is no tolerance band to straddle,
  because there is no band at all — agreement is exact, and the
  verdict is computed from the agreed flags rather than taken from
  the LLM.
- The money side has no second spread source either. The release and
  refund amounts are deterministic functions of the (unique) verdict
  and the (stored) milestone amount: ACCEPT → amount, PARTIAL →
  amount/2 + amount/2 (exact, amount is even), REJECT → 0 + amount.
  Pro-rata refunds are computed once, in the contract, after
  consensus, under a fixed remainder rule — validators never vote on
  the split.
- Date spread: the current date must match exactly across leader and
  validators. A midnight rollover during evaluation makes validation
  fail and the evaluation retryable; it cannot produce two different
  accepted dates, because only one date can equal the validator's own
  fetch.
- What this does NOT claim: exact flag agreement cannot force the LLM
  to be right. If a majority of validators independently misjudge the
  same evidence the same way, the wrong verdict finalizes. That is an
  LLM-quality limit, not a tolerance hole — no band exists for a wrong
  leader to hide inside, and the challenge round exists precisely so
  a second independent evaluation can surface disagreement before
  money moves. Borderline evidence may need retries when validators
  disagree; that is the mechanism working, not failing.

## Challenge and freeze

- The first evaluation leaves a pending verdict (`EVALUATING`). Anyone
  may finalize it with `finalize_milestone`; anyone except the
  creator may challenge it first with `challenge_milestone`.
- Challenge runs a second independent evaluation (round 2). If the
  second verdict equals the first, the challenge fails: the verdict
  finalizes immediately, the challenger loses 5 reputation, and 50
  mGEN of the bond is distributed to backers. If it differs, the
  milestone freezes with both verdicts kept as witness and no money
  moves.
- A frozen milestone is resolved by `resolve_frozen` (round 3). The
  third verdict is the tie-break and finalizes the milestone; all
  three evaluation rounds stay in the record as witness. A finalized
  verdict is never overwritten.

## What this contract does not do

- It does not hold real funds, custody real GEN, or move real
  cryptocurrency. The ledger is simulated mGEN only.
- It does not prove delivery from the evidence alone: the LLM judges
  the text against strict criteria, and the verdict is only as good
  as the validators' independent agreement on those flags.
- It does not authenticate evidence links by fetching them. A URL in
  the evidence is a checkable reference for humans; the contract
  checks that a reference is present, not that it resolves.
- It does not use a clock. "Current date" comes from a public time
  API fetched independently by leader and validators; if that source
  is down, evaluation waits rather than guessing.
