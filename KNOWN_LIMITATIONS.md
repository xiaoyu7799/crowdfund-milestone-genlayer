# Known limitations

- The verdict is only as good as the validators' independent agreement
  on three binary snapshot criteria. Exact flag agreement pins the
  verdict to a single value (see `docs/mechanism.md`), but it cannot
  force the underlying LLM judgement to be right: if a majority of
  validators independently misjudge the same evidence the same way,
  the wrong verdict settles. The challenge round is the counterweight.
- Borderline evidence may need retries. When validators disagree on
  even one flag, or fetch different snapshot bytes, review fails
  consensus and the milestone stays open; this is the mechanism
  working, not a bug.
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
