# Known limitations

- The verdict is only as good as the validators' independent agreement
  on three binary snapshot criteria. Verdict-level agreement pins the
  verdict to a single value (see `docs/mechanism.md`), but it cannot
  force the underlying LLM judgement to be right: if a majority of
  validators independently misjudge the same evidence the same way,
  the wrong verdict settles. The challenge round is the counterweight.
- Borderline evidence may need retries. When validators split across
  a verdict boundary, review fails consensus and the milestone stays
  open; this is the mechanism working, not a bug. Observed on chain:
  the unrelated-page case (a real delivery file for the wrong
  milestone) took 4 review attempts to converge on `REJECT`. The
  retry budget is 5 attempts; if validators never converge on one
  verdict, the milestone stays open with its funds escrowed — a
  liveness limitation, not a safety hole, since nothing can be paid
  out without a converged verdict.
- Only the first 4000 characters of a fetched reference are judged.
  Delivery records kept for this contract are short, so the whole
  record is judged; a longer page's tail does not count towards the
  verdict.
- The reference fetch depends on the reference host and, for GitHub
  file URLs, on the public GitHub API being reachable. If either is
  down, review fails before any write and can be retried.
- The rationale sentence stored with each review is
  leader-provided witness text for humans to read. It is not used for
  the verdict and is not part of the consensus check. The quotation
  is part of the consensus check: it must appear verbatim in the
  fetched snapshot.
- A payable call that raises keeps the value: on Studionet the GEN
  sent with a failed payable call stays in the contract while the
  state reverts. This contract therefore never raises while holding
  value — invalid backings and challenges are rejected with the full
  value credited back as a withdrawable credit (see
  `docs/mechanism.md`, "Failed payments never swallow GEN").
- The challenge window runs to the end of the review's UTC day: a
  same-day confirm is rejected on chain, and confirming is possible
  from the next UTC day. A review made shortly before midnight UTC
  therefore has a short window.
- "Current date" comes from a public time API
  (`https://timeapi.io/api/Time/current/zone?timeZone=UTC`) fetched
  independently by leader and validators. If that source is down,
  review waits rather than guessing. A midnight rollover during
  review makes validation fail and the review retryable.
- GEN here is testnet GEN on Stable Studionet, free from the faucet
  with zero cash cost. Amounts are wei integers (1 GEN = 10^18 wei);
  the site and the contract display both GEN and wei.

- Historical receipts describe their own deployments. Current-source live checks are recorded separately in evidence/paired-validation.json.
- Rebuttal relevance is a semantic consensus decision. Local fixtures test the
  decision gate and independent validation; they do not establish real model
  accuracy. Both references are re-fetched on rounds 2 and 3; mutable URLs can
  change. A counter page that stops being a valid rebuttal cannot resolve a
  frozen dispute until valid evidence is available again.
- The browser stores only a password-encrypted signer backup (PBKDF2-SHA256,
  310000 iterations, AES-256-GCM). Export it before clearing browser data and
  retain the password. An unlocked or compromised browser can expose the key.

- A consensus-disagreed payable challenge can leave value in the platform
  balance without applying contract credits. This occurred on the superseded
  paired-v1 deployment: one 1 GEN challenge ended MAJORITY_DISAGREE; the 1 GEN
  remained outside its ledger. The original receipt and balance readback are
  retained in `evidence/history/paired-v1`. Reducing irrelevant score agreement
  prevents that observed split but cannot guarantee consensus availability.
  The accounting ledger invariant alone cannot detect platform-retained surplus;
  verification must also compare the actual balance with credits plus escrow.
