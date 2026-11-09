"""Local tests for contracts/milestone_fund.py.

Uses a stub `genlayer` module (no GenVM here). Tests pure functions
against the standard library, and runs the full deterministic lifecycle
with a mocked nondet layer that simulates validator consensus on fixed
criterion flags.

These are LOCAL MOCK tests, not on-chain evidence. The on-chain flow
is verified separately by scripts/flow.mjs against the live contract.
"""
import hashlib
import json
import sys
import types
from datetime import date

# ---------------------------------------------------------------------------
# genlayer stub
# ---------------------------------------------------------------------------

class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class _Public:
    @staticmethod
    def write(fn):
        return fn

    @staticmethod
    def view(fn):
        return fn


class _VM:
    UserError = UserError
    Return = Return

    @staticmethod
    def run_nondet_unsafe(fn, validate):
        try:
            result = fn()
        except Exception as exc:
            # Leader raised: validator agrees only if its own run also
            # raises a UserError (mirrors the contract's validate()).
            if isinstance(exc, UserError) and validate(exc):
                raise
            raise RuntimeError("mock consensus: leader error rejected")
        leader = Return(result)
        if validate(leader):
            return result
        raise RuntimeError("mock consensus: validate() rejected leader")


class _Response:
    def __init__(self, status, body):
        self.status = status
        self.body = body


class _Web:
    # Test-controlled current date (ISO string).
    current_date = "2026-11-09"

    @classmethod
    def request(cls, url, method="GET"):
        assert url == "https://timeapi.io/api/Time/current/zone?timeZone=UTC", url
        body = json.dumps({"dateTime": cls.current_date + "T07:39:52.6716821"}).encode("utf-8")
        return _Response(200, body)


class _Nondet:
    web = _Web
    # Queue of flag-vectors the mocked LLM returns, one per judge() call.
    # Each judge() call pops one; validate() re-runs judge(), so a single
    # adjudication consumes 2 entries (leader + validator), both equal.
    flag_queue = []

    @classmethod
    def exec_prompt(cls, prompt, response_format="json"):
        assert response_format == "json"
        if not cls.flag_queue:
            raise RuntimeError("mock exec_prompt: flag queue empty")
        flags = cls.flag_queue.pop(0)
        return {
            "deliverable_named": flags[0],
            "verifiable_reference": flags[1],
            "completion_described": flags[2],
            "rationale": "Mock rationale.",
        }


class _Message:
    sender_address = "0x1111111111111111111111111111111111111111"


class _ContractBase:
    pass


gl = types.SimpleNamespace(
    public=_Public(),
    vm=_VM(),
    nondet=_Nondet(),
    message=_Message(),
    Contract=_ContractBase,
)
genlayer = types.ModuleType("genlayer")
genlayer.__all__ = ["gl", "u256"]
genlayer.gl = gl
genlayer.u256 = int
sys.modules["genlayer"] = genlayer

sys.path.insert(0, "/tmp/crowdfund-milestone/contracts")
import milestone_fund as mf  # noqa: E402

PASS = 0
FAIL = 0


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ok: {name}")
    else:
        FAIL += 1
        print(f"  FAIL: {name} {extra}")


def expect_error(name, fn):
    try:
        fn()
    except mf.gl.vm.UserError:
        check(name, True)
        return
    except Exception as exc:  # noqa: BLE001
        check(name, False, f"(wrong exception: {type(exc).__name__}: {exc})")
        return
    check(name, False, "(no error raised)")


def set_sender(addr):
    mf.gl.message.sender_address = addr


# ---------------------------------------------------------------------------
# 1. pure SHA-256 vs hashlib
# ---------------------------------------------------------------------------
print("== pure_sha256_hex ==")
for text in ["", "abc", "hello world", "MilestoneFund" * 40, "evidence: sensor kit v1.0 https://example.com/x"]:
    check(f"sha256({text[:20]!r})", mf.pure_sha256_hex(text) == hashlib.sha256(text.encode()).hexdigest())

# ---------------------------------------------------------------------------
# 2. date helpers
# ---------------------------------------------------------------------------
print("== date helpers ==")
for y, m, d in [(1970, 1, 1), (2026, 11, 9), (2024, 2, 29), (2000, 2, 29), (1900, 3, 1), (2031, 12, 31)]:
    ds = f"{y:04d}-{m:02d}-{d:02d}"
    expected = date(y, m, d).toordinal() - date(1970, 1, 1).toordinal()
    check(f"days({ds}) == {expected}", mf._date_to_days(ds) == expected)
    check(f"valid({ds})", mf._valid_date_format(ds) is True)
for bad in ["2026-13-01", "2026-02-30", "2023-02-29", "2026-11-9", "2026/11/09", "2026-00-10", "2026-04-31", "abcd-11-09", "2026-11-09x"]:
    check(f"invalid({bad!r})", mf._valid_date_format(bad) is False)

# ---------------------------------------------------------------------------
# 3. verdict truth table
# ---------------------------------------------------------------------------
print("== verdict_from_flags ==")
check("3/3 ACCEPT", mf._verdict_from_flags(["true", "true", "true"]) == "ACCEPT")
for flags in (["true", "true", "false"], ["true", "false", "true"], ["false", "true", "true"]):
    check(f"{flags} PARTIAL", mf._verdict_from_flags(flags) == "PARTIAL")
for flags in (["true", "false", "false"], ["false", "false", "false"], ["false", "true", "false"]):
    check(f"{flags} REJECT", mf._verdict_from_flags(flags) == "REJECT")

# ---------------------------------------------------------------------------
# 4. distribute remainder rule
# ---------------------------------------------------------------------------
print("== distribute ==")
c = mf.MilestoneFund()
campaign = {"backers": [{"address": "0xB", "amount": 6000}, {"address": "0xC", "amount": 4000}], "total_backed": 10000}
balances = {}
out = c._distribute(campaign, balances, 51)
check("distribute 51 -> 31/20", out == [{"address": "0xB", "amount": 31}, {"address": "0xC", "amount": 20}], str(out))
check("distribute balances", balances == {"0xB": 31, "0xC": 20}, str(balances))
balances = {}
out = c._distribute(campaign, balances, 4000)
check("distribute 4000 -> 2400/1600 exact", out == [{"address": "0xB", "amount": 2400}, {"address": "0xC", "amount": 1600}], str(out))

# ---------------------------------------------------------------------------
# 5. full lifecycle with the planned live-demo numbers
# ---------------------------------------------------------------------------
print("== full lifecycle (demo numbers) ==")
A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
_Nondet.flag_queue = []
c = mf.MilestoneFund()
c.__init__()

set_sender(A)
r = json.loads(c.claim_demo_funds())
check("A claims 10000", r["balance"] == 10000, str(r))
expect_error("A double claim rejected", lambda: c.claim_demo_funds())

set_sender(A)
milestones = json.dumps([
    {"title": "Sensor kits assembled", "amount": 4000},
    {"title": "Dashboard live", "amount": 4000},
    {"title": "Field report published", "amount": 2000},
])
r = json.loads(c.create_campaign("Riverside Community Garden sensor network", 10000, milestones))
check("campaign 0 created, FUNDING", r["id"] == 0 and r["status"] == "FUNDING", str(r))
expect_error("odd milestone amount rejected", lambda: c.create_campaign(
    "X", 10000, json.dumps([{"title": "M", "amount": 4001}, {"title": "N", "amount": 5999}])))
expect_error("sum != goal rejected", lambda: c.create_campaign(
    "X", 9000, json.dumps([{"title": "M", "amount": 4000}])))
expect_error("empty milestones rejected", lambda: c.create_campaign("X", 1000, "[]"))

set_sender(B)
json.loads(c.claim_demo_funds())
r = json.loads(c.back(0, 6000))
check("B backs 6000, still FUNDING", r["total_backed"] == 6000 and r["status"] == "FUNDING", str(r))
expect_error("back exceeding goal rejected", lambda: c.back(0, 5000))
expect_error("odd back amount rejected", lambda: c.back(0, 999))
set_sender(C)
json.loads(c.claim_demo_funds())
r = json.loads(c.back(0, 4000))
check("C backs 4000, FUNDED", r["total_backed"] == 10000 and r["status"] == "FUNDED", str(r))
expect_error("back after funded rejected", lambda: c.back(0, 2000))

# evidence: only creator may submit
set_sender(B)
expect_error("non-creator cannot submit evidence",
             lambda: c.submit_milestone_evidence(0, 0, "x" * 30, "2026-11-09"))
set_sender(A)
expect_error("short evidence rejected",
             lambda: c.submit_milestone_evidence(0, 0, "too short", "2026-11-09"))
expect_error("bad evidence date rejected",
             lambda: c.submit_milestone_evidence(0, 0, "x" * 30, "09/11/2026"))
r = json.loads(c.submit_milestone_evidence(
    0, 0,
    "Sensor kits assembled: 12 Riverside garden sensor kits built and installed, "
    "each reporting live. Build log: https://example.org/garden/build-log-v1",
    "2026-11-09"))
check("m0 evidence stored, hash matches hashlib",
      r["evidence_hash"] == hashlib.sha256(
          ("Sensor kits assembled: 12 Riverside garden sensor kits built and installed, "
           "each reporting live. Build log: https://example.org/garden/build-log-v1").encode()).hexdigest(),
      str(r))
json.loads(c.submit_milestone_evidence(
    0, 1,
    "We plan to build the dashboard soon and will share updates once work starts.",
    "2026-11-09"))
json.loads(c.submit_milestone_evidence(
    0, 2,
    "Field report published: the garden field report is written and covers all 12 sensors "
    "with weekly readings. It is ready to share with backers.",
    "2026-11-09"))

# m0: ACCEPT -> finalize -> release 4000
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
set_sender(B)
r = json.loads(c.evaluate_milestone(0, 0))
check("m0 EVALUATING, pending ACCEPT", r["pending_verdict"] == "ACCEPT" and r["status"] == "EVALUATING", str(r))
expect_error("challenge by creator rejected", lambda: (set_sender(A), c.challenge_milestone(0, 0))[1])
set_sender(B)
r = json.loads(c.finalize_milestone(0, 0))
check("m0 FINALIZED ACCEPT, released 4000",
      r["final_verdict"] == "ACCEPT" and r["settlement"]["released"] == 4000 and r["settlement"]["refunded"] == 0, str(r))
expect_error("finalize twice rejected", lambda: c.finalize_milestone(0, 0))

# m1: REJECT -> finalize -> refund 4000 pro-rata 2400/1600
_Nondet.flag_queue = [["false", "false", "false"], ["false", "false", "false"]]
r = json.loads(c.evaluate_milestone(0, 1))
check("m1 pending REJECT", r["pending_verdict"] == "REJECT", str(r))
r = json.loads(c.finalize_milestone(0, 1))
check("m1 FINALIZED REJECT, refunded 4000",
      r["final_verdict"] == "REJECT" and r["settlement"]["refunded"] == 4000, str(r))
check("m1 refund payouts 2400/1600",
      r["settlement"]["payouts"] == [{"address": B, "amount": 2400}, {"address": C, "amount": 1600}], str(r))

# m2: PARTIAL -> challenge agrees -> challenge fails, finalize via challenge
_Nondet.flag_queue = [["true", "false", "true"], ["true", "false", "true"],
                         ["true", "false", "true"], ["true", "false", "true"]]
r = json.loads(c.evaluate_milestone(0, 2))
check("m2 pending PARTIAL", r["pending_verdict"] == "PARTIAL", str(r))
r = json.loads(c.challenge_milestone(0, 2))
check("m2 challenge FAILED, second PARTIAL, FINALIZED",
      r["challenge_outcome"] == "FAILED" and r["second_verdict"] == "PARTIAL" and r["status"] == "FINALIZED", str(r))
check("m2 settlement release 1000 refund 1000",
      r["settlement"]["released"] == 1000 and r["settlement"]["refunded"] == 1000, str(r))

camp = json.loads(c.get_campaign(0))
check("escrow drained to 0", camp["escrow"] == 0, str(camp["escrow"]))
bal_a = json.loads(c.get_balance(A))
bal_b = json.loads(c.get_balance(B))
bal_c = json.loads(c.get_balance(C))
check("A balance 15000", bal_a["balance"] == 15000, str(bal_a))
check("B balance 6980", bal_b["balance"] == 6980, str(bal_b))
check("C balance 8020", bal_c["balance"] == 8020, str(bal_c))
check("total conserved 30000", bal_a["balance"] + bal_b["balance"] + bal_c["balance"] == 30000)
check("B reputation 95 after failed challenge", bal_b["reputation"] == 95, str(bal_b))
check("A reputation 100 (+5 ACCEPT, -5 REJECT, +0 PARTIAL)", bal_a["reputation"] == 100, str(bal_a))
lb = json.loads(c.get_leaderboard(10))
check("leaderboard order C(100,backed 4000) A(100,backed 0) B(95)",
      [row["address"] for row in lb] == [C, A, B], str(lb))

# ---------------------------------------------------------------------------
# 6. frozen path: round 2 disagrees, round 3 tie-break decides
# ---------------------------------------------------------------------------
print("== frozen / resolve path ==")
_Nondet.flag_queue = []
c2 = mf.MilestoneFund()
c2.__init__()
set_sender(A)
json.loads(c2.claim_demo_funds())
json.loads(c2.create_campaign("Test campaign", 2000, json.dumps([{"title": "Only milestone", "amount": 2000}])))
set_sender(B)
json.loads(c2.claim_demo_funds())
json.loads(c2.back(0, 2000))
set_sender(A)
json.loads(c2.submit_milestone_evidence(
    0, 0, "Borderline evidence: a prototype exists, see https://example.org/proto", "2026-11-09"))
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
r = json.loads(c2.evaluate_milestone(0, 0))
check("frozen-path m0 pending ACCEPT", r["pending_verdict"] == "ACCEPT", str(r))
_Nondet.flag_queue = [["false", "false", "false"], ["false", "false", "false"]]
set_sender(B)
r = json.loads(c2.challenge_milestone(0, 0))
check("challenge CONTRADICTION_FROZEN, bond returned, no money moved",
      r["challenge_outcome"] == "CONTRADICTION_FROZEN" and r["status"] == "FROZEN" and r["settlement"] is None, str(r))
bal_b2 = json.loads(c2.get_balance(B))
check("B balance back to 8000 after bond refund", bal_b2["balance"] == 8000, str(bal_b2))
check("B reputation unchanged 100", bal_b2["reputation"] == 100, str(bal_b2))
expect_error("finalize frozen rejected", lambda: c2.finalize_milestone(0, 0))
_Nondet.flag_queue = [["true", "false", "true"], ["true", "false", "true"]]
r = json.loads(c2.resolve_frozen(0, 0))
check("resolve final PARTIAL, witness keeps all 3 verdicts",
      r["final_verdict"] == "PARTIAL" and r["witness_verdicts"] == ["ACCEPT", "REJECT", "PARTIAL"], str(r))
check("resolve settlement 1000/1000",
      r["settlement"]["released"] == 1000 and r["settlement"]["refunded"] == 1000, str(r))
camp2 = json.loads(c2.get_campaign(0))
check("frozen milestone FINALIZED, verdict immutable record kept",
      camp2["milestones"][0]["status"] == "FINALIZED"
      and camp2["milestones"][0]["final_verdict"] == "PARTIAL"
      and len(camp2["milestones"][0]["evaluations"]) == 3, str(camp2["milestones"][0]["status"]))

# ---------------------------------------------------------------------------
# 7. staleness: evidence older than 30 days cannot be evaluated
# ---------------------------------------------------------------------------
print("== staleness gate ==")
_Nondet.flag_queue = []
c3 = mf.MilestoneFund()
c3.__init__()
set_sender(A)
json.loads(c3.claim_demo_funds())
json.loads(c3.create_campaign("Stale test", 2000, json.dumps([{"title": "M", "amount": 2000}])))
set_sender(B)
json.loads(c3.claim_demo_funds())
json.loads(c3.back(0, 2000))
set_sender(A)
json.loads(c3.submit_milestone_evidence(0, 0, "Old evidence text that is long enough here.", "2026-09-01"))
_Web.current_date = "2026-11-09"
expect_error("stale evidence (69 days) evaluation raises before write",
             lambda: c3.evaluate_milestone(0, 0))
camp3 = json.loads(c3.get_campaign(0))
check("stale milestone still EVIDENCE_SUBMITTED, nothing written",
      camp3["milestones"][0]["status"] == "EVIDENCE_SUBMITTED"
      and camp3["milestones"][0]["evaluations"] == [], str(camp3["milestones"][0]["status"]))
# fresh evidence on the boundary (exactly 30 days) evaluates fine
json.loads(c3.submit_milestone_evidence(0, 0, "Fresh evidence text that is long enough here.", "2026-10-10"))
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
r = json.loads(c3.evaluate_milestone(0, 0))
check("30-day-old evidence evaluates (boundary inclusive)", r["pending_verdict"] == "ACCEPT", str(r))
# future-dated evidence raises (fresh campaign: the previous milestone is
# EVALUATING by now, so resubmitting to it is correctly rejected)
c4 = mf.MilestoneFund()
c4.__init__()
set_sender(A)
json.loads(c4.claim_demo_funds())
json.loads(c4.create_campaign("Future test", 2000, json.dumps([{"title": "M", "amount": 2000}])))
set_sender(B)
json.loads(c4.claim_demo_funds())
json.loads(c4.back(0, 2000))
set_sender(A)
json.loads(c4.submit_milestone_evidence(0, 0, "Future evidence text that is long enough here.", "2026-11-10"))
expect_error("future-dated evidence evaluation raises",
             lambda: c4.evaluate_milestone(0, 0))
_Web.current_date = "2026-11-09"

print(f"\n{ PASS } passed, { FAIL } failed")
sys.exit(1 if FAIL else 0)
