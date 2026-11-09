# Known limitations

- The verdict is only as good as the validators' independent agreement
  on three binary evidence criteria. Exact flag agreement pins the
  verdict to a single value (see `docs/mechanism.md`), but it cannot
  force the underlying LLM judgement to be right: if a majority of
  validators independently misjudge the same evidence the same way,
  the wrong verdict settles. The challenge round is the counterweight.
- Borderline evidence may need retries. When validators disagree on
  even one flag, review fails consensus and the milestone stays
  open; this is the mechanism working, not a bug.
- Evidence links are checked for presence, not resolved. A URL in the
  evidence is a checkable reference for humans; the contract does not
  fetch it.
- "Current date" comes from a public time API
  (`https://timeapi.io/api/Time/current/zone?timeZone=UTC`) fetched
  independently by leader and validators. If that source is down,
  review waits rather than guessing. A midnight rollover during
  review makes validation fail and the review retryable.
- The rationale sentence stored with each review is
  leader-provided witness text for humans to read. It is not used for
  the verdict and is not part of the consensus check.
- The challenge window is "until someone confirms": there is no clock
  on Studionet, so the window is closed by an explicit confirm call,
  not by time passing.
- GEN here is testnet GEN on Stable Studionet, free from the faucet
  with zero cash cost. Amounts are wei integers (1 GEN = 10^18 wei);
  the site and the contract display both GEN and wei.
