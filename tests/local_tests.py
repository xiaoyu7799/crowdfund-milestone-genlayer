"""Local tests for contracts/milestone_fund.py.

Uses a stub `genlayer` module (no GenVM here). Tests pure functions
against the standard library, and runs the full deterministic lifecycle
with a mocked nondet layer that simulates validator consensus on fixed
criterion flags, plus the real-GEN pull-payment accounting (wei credits,
challenge stake, withdraw) with a mocked transfer ledger.

These are LOCAL MOCK tests, not on-chain evidence. The on-chain flow
is verified separately by scripts/flow.mjs against the live contract.
"""
import hashlib
import json
import os
import sys
import types
from datetime import date

# ---------------------------------------------------------------------------
# genlayer stub
# ---------------------------------------------------------------------------

TRANSFERS = []  # (address, wei) recorded by the mocked _Recipient


class UserError(Exception):
    pass


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


def _decorator(fn):
    return fn


_write = _decorator
_write.payable = _decorator


class _Public:
    write = staticmethod(_write)
    view = staticmethod(_decorator)


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
    value = 0


class _Address(str):
    pass


class _Recipient:
    def __init__(self, addr):
        self.addr = addr

    def emit_transfer(self, value):
        TRANSFERS.append((str(self.addr), int(value)))


class _EVM:
    @staticmethod
    def contract_interface(cls):
        # Mirror GenVM: _Recipient(Address(...)) builds a call handle
        # whose emit_transfer records the transfer in the mock ledger.
        class Wrapped:
            def __init__(self, addr):
                self.addr = addr

            def emit_transfer(self, value):
                TRANSFERS.append((str(self.addr), int(value)))

        Wrapped.__name__ = cls.__name__
        return Wrapped


class _ContractBase:
    @property
    def balance(self):
        return getattr(self, "_mock_balance", 0)

    @balance.setter
    def balance(self, v):
        self._mock_balance = v


gl = types.SimpleNamespace(
    public=_Public(),
    vm=_VM(),
    nondet=_Nondet(),
    message=_Message(),
    evm=_EVM(),
    Contract=_ContractBase,
)
genlayer = types.ModuleType("genlayer")
genlayer.__all__ = ["gl", "u256", "Address"]
genlayer.gl = gl
genlayer.u256 = int
genlayer.Address = _Address
sys.modules["genlayer"] = genlayer

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "contracts"))
import milestone_fund as mf  # noqa: E402

GEN = 10 ** 18
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


def set_sender(addr, value=0):
    mf.gl.message.sender_address = addr
    mf.gl.message.value = value


def sync_balance(c):
    """Mock self.balance = received - withdrawn (what the chain holds)."""
    c.balance = int(c.total_received_wei) - int(c.total_withdrawn_wei)


def invariant(c):
    totals = json.loads(c.get_totals())
    return (
        totals["invariant_ok"] is True
        and int(totals["total_received_wei"])
        == int(totals["total_withdrawn_wei"])
        + int(totals["credits_outstanding_wei"])
        + int(totals["escrow_locked_wei"])
    )


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
# 4. distribute remainder rule (wei strings)
# ---------------------------------------------------------------------------
print("== distribute (wei) ==")
c = mf.MilestoneFund()
c.__init__()
campaign = {"backers": [{"address": "0xB", "amount": str(60 * GEN)}, {"address": "0xC", "amount": str(40 * GEN)}], "total_backed_wei": str(100 * GEN)}
credits = {}
out = c._distribute(campaign, credits, 51)
check("distribute 51 wei -> 31/20, remainder to largest",
      out == [{"address": "0xB", "amount_wei": "31"}, {"address": "0xC", "amount_wei": "20"}], str(out))
check("distribute credits", credits == {"0xB": "31", "0xC": "20"}, str(credits))
credits = {}
out = c._distribute(campaign, credits, 40 * GEN)
check("distribute 40 GEN -> 24/16 exact",
      out == [{"address": "0xB", "amount_wei": str(24 * GEN)}, {"address": "0xC", "amount_wei": str(16 * GEN)}], str(out))

# ---------------------------------------------------------------------------
# 5. wei validation
# ---------------------------------------------------------------------------
print("== wei validation ==")
expect_error("odd milestone amount rejected",
             lambda: mf._check_even_positive_wei("4001", "milestone_amount"))
expect_error("non-numeric wei rejected",
             lambda: mf._check_even_positive_wei("40 GEN", "milestone_amount"))
expect_error("zero wei rejected",
             lambda: mf._check_even_positive_wei("0", "milestone_amount"))
check("even wei accepted", mf._check_even_positive_wei(str(40 * GEN), "x") == 40 * GEN)
check("0.5 GEN is even wei", (500000000000000000 % 2) == 0)

# ---------------------------------------------------------------------------
# 6. full lifecycle with the planned live numbers (real GEN, wei)
#    goal 100 GEN, milestones 40/40/20 GEN; B backs 60, C backs 40.
# ---------------------------------------------------------------------------
print("== full lifecycle (live numbers, wei) ==")
A = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
B = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
C = "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC"
_Nondet.flag_queue = []
TRANSFERS.clear()
c = mf.MilestoneFund()
c.__init__()
sync_balance(c)

set_sender(A)
milestones = json.dumps([
    {"title": "Sensor kits assembled", "amount": str(40 * GEN)},
    {"title": "Dashboard live", "amount": str(40 * GEN)},
    {"title": "Field report published", "amount": str(20 * GEN)},
])
r = json.loads(c.create_campaign("Riverside Community Garden sensor network", str(100 * GEN), milestones))
check("campaign 0 created, FUNDING", r["id"] == 0 and r["status"] == "FUNDING", str(r))
check("goal stored as wei string", r["goal_wei"] == str(100 * GEN), str(r))
expect_error("odd milestone amount rejected", lambda: c.create_campaign(
    "X", str(100 * GEN), json.dumps([{"title": "M", "amount": "4001"}, {"title": "N", "amount": str(100 * GEN - 4001)}])))
expect_error("sum != goal rejected", lambda: c.create_campaign(
    "X", str(90 * GEN), json.dumps([{"title": "M", "amount": str(40 * GEN)}])))
expect_error("empty milestones rejected", lambda: c.create_campaign(
    "X", str(1000), "[]"))
expect_error("goal as int rejected (must be wei string)", lambda: c.create_campaign(
    "X", 100, json.dumps([{"title": "M", "amount": str(100)}])))

# back with real GEN (payable value)
set_sender(B, 60 * GEN)
r = json.loads(c.back_campaign(0))
sync_balance(c)
check("B backs 60 GEN, still FUNDING",
      r["total_backed_wei"] == str(60 * GEN) and r["status"] == "FUNDING", str(r))
expect_error("back exceeding goal rejected", lambda: (set_sender(B, 50 * GEN), c.back_campaign(0))[1])
expect_error("zero-value back rejected", lambda: (set_sender(B, 0), c.back_campaign(0))[1])
set_sender(C, 40 * GEN)
r = json.loads(c.back_campaign(0))
sync_balance(c)
check("C backs 40 GEN, MILESTONE_REVIEW",
      r["total_backed_wei"] == str(100 * GEN) and r["status"] == "MILESTONE_REVIEW", str(r))
check("invariant holds after funding", invariant(c))
expect_error("back after funded rejected", lambda: (set_sender(B, 2 * GEN), c.back_campaign(0))[1])

# evidence: only creator may submit
set_sender(B)
expect_error("non-creator cannot submit evidence",
             lambda: c.submit_milestone_proof(0, 0, "x" * 30, "2026-11-09"))
set_sender(A)
expect_error("short evidence rejected",
             lambda: c.submit_milestone_proof(0, 0, "too short", "2026-11-09"))
expect_error("bad evidence date rejected",
             lambda: c.submit_milestone_proof(0, 0, "x" * 30, "09/11/2026"))
r = json.loads(c.submit_milestone_proof(
    0, 0,
    "Sensor kits assembled: 12 Riverside garden sensor kits built and installed, "
    "each reporting live. Build log: https://example.org/garden/build-log-v1",
    "2026-11-09"))
check("m0 evidence stored, hash matches hashlib",
      r["evidence_hash"] == hashlib.sha256(
          ("Sensor kits assembled: 12 Riverside garden sensor kits built and installed, "
           "each reporting live. Build log: https://example.org/garden/build-log-v1").encode()).hexdigest(),
      str(r))
json.loads(c.submit_milestone_proof(
    0, 1,
    "We plan to build the dashboard soon and will share updates once work starts.",
    "2026-11-09"))
json.loads(c.submit_milestone_proof(
    0, 2,
    "Field report published: the garden field report is written and covers all 12 sensors "
    "with weekly readings. It is ready to share with backers.",
    "2026-11-09"))

# m0: ACCEPT -> confirm -> RELEASED, creator credit 40 GEN
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
set_sender(B)
r = json.loads(c.review_milestone(0, 0))
check("m0 MILESTONE_REVIEW, pending ACCEPT", r["pending_verdict"] == "ACCEPT" and r["status"] == "MILESTONE_REVIEW", str(r))
expect_error("challenge by creator rejected", lambda: (set_sender(A, 1 * GEN), c.challenge_milestone(0, 0))[1])
expect_error("challenge with wrong stake rejected", lambda: (set_sender(B, 2 * GEN), c.challenge_milestone(0, 0))[1])
set_sender(B)
r = json.loads(c.confirm_milestone(0, 0))
check("m0 RELEASED ACCEPT, released 40 GEN",
      r["final_verdict"] == "ACCEPT" and r["settlement"]["released_wei"] == str(40 * GEN) and r["settlement"]["refunded_wei"] == "0", str(r))
check("creator credit 40 GEN", int(c.get_credit(A)) == 40 * GEN, str(c.get_credit(A)))
expect_error("confirm twice rejected", lambda: c.confirm_milestone(0, 0))
check("invariant holds after m0", invariant(c))

# m1: REJECT -> confirm -> REFUNDED, backers 24/16 GEN
_Nondet.flag_queue = [["false", "false", "false"], ["false", "false", "false"]]
r = json.loads(c.review_milestone(0, 1))
check("m1 pending REJECT", r["pending_verdict"] == "REJECT", str(r))
r = json.loads(c.confirm_milestone(0, 1))
check("m1 REFUNDED REJECT, refunded 40 GEN",
      r["final_verdict"] == "REJECT" and r["settlement"]["refunded_wei"] == str(40 * GEN), str(r))
check("m1 refund payouts 24/16 GEN",
      r["settlement"]["payouts"] == [{"address": B, "amount_wei": str(24 * GEN)}, {"address": C, "amount_wei": str(16 * GEN)}], str(r))
check("B credit 24 GEN after m1", int(c.get_credit(B)) == 24 * GEN)
check("C credit 16 GEN after m1", int(c.get_credit(C)) == 16 * GEN)

# m2: PARTIAL -> challenge agrees -> challenge FAILED, 1 GEN stake folds in:
# settlement 21 GEN -> creator 10.5, backers 10.5 (B 6.3, C 4.2)
_Nondet.flag_queue = [["true", "false", "true"], ["true", "false", "true"],
                      ["true", "false", "true"], ["true", "false", "true"]]
r = json.loads(c.review_milestone(0, 2))
check("m2 pending PARTIAL", r["pending_verdict"] == "PARTIAL", str(r))
set_sender(B, 1 * GEN)
r = json.loads(c.challenge_milestone(0, 2))
sync_balance(c)
check("m2 challenge FAILED, second PARTIAL, PARTIAL_RELEASED",
      r["challenge_outcome"] == "FAILED" and r["second_verdict"] == "PARTIAL" and r["status"] == "PARTIAL_RELEASED", str(r))
check("m2 settlement 21 GEN (20 + 1 forfeited stake)",
      r["settlement"]["released_wei"] == str(105 * GEN // 10) and r["settlement"]["refunded_wei"] == str(105 * GEN // 10), str(r))
check("m2 refund payouts 6.3/4.2 GEN",
      r["settlement"]["payouts"] == [{"address": B, "amount_wei": str(63 * GEN // 10)}, {"address": C, "amount_wei": str(42 * GEN // 10)}], str(r))

camp = json.loads(c.get_campaign(0))
check("escrow drained to 0", camp["escrow_wei"] == "0", str(camp["escrow_wei"]))
check("campaign MILESTONE_REVIEW, all milestones terminal",
      all(m["status"] in ("RELEASED", "REFUNDED", "PARTIAL_RELEASED") for m in camp["milestones"]))
check("A credit 50.5 GEN (40 + 10.5)", int(c.get_credit(A)) == 505 * GEN // 10, str(c.get_credit(A)))
check("B credit 30.3 GEN (24 + 6.3)", int(c.get_credit(B)) == 303 * GEN // 10, str(c.get_credit(B)))
check("C credit 20.2 GEN (16 + 4.2)", int(c.get_credit(C)) == 202 * GEN // 10, str(c.get_credit(C)))
check("invariant holds before withdraw", invariant(c))
totals = json.loads(c.get_totals())
check("total received 101 GEN (100 backed + 1 stake)", totals["total_received_wei"] == str(101 * GEN), str(totals))
check("credits outstanding 101 GEN", totals["credits_outstanding_wei"] == str(101 * GEN), str(totals))

# standing is history, not a 100-point score
sup_b = json.loads(c.get_supporter(B))
check("B standing: backed 60 GEN, 3 milestones completed, 1 challenge lost",
      sup_b["backed_wei_total"] == str(60 * GEN)
      and sup_b["milestones_completed_as_backer"] == 3
      and sup_b["challenges_lost"] == 1 and sup_b["challenges_won"] == 0, str(sup_b))
sup_a = json.loads(c.get_supporter(A))
check("A standing: 1 campaign, 2 milestones released",
      sup_a["campaigns_created"] == 1 and sup_a["milestones_released_as_creator"] == 2, str(sup_a))
board = json.loads(c.get_supporter_board(10))
check("supporter board ordered by backed: B then C then A",
      [row["address"] for row in board] == [B, C, A], str(board))

# withdraw_payout: pull payment, credit zeroed before transfer
TRANSFERS.clear()
set_sender(A)
r = json.loads(c.withdraw_payout())
sync_balance(c)
check("A withdraws 50.5 GEN", r["withdrawn_wei"] == str(505 * GEN // 10), str(r))
check("A transfer recorded to A", TRANSFERS == [(A, 505 * GEN // 10)], str(TRANSFERS))
check("A credit zero after withdraw", int(c.get_credit(A)) == 0)
expect_error("double withdraw rejected", lambda: c.withdraw_payout())
set_sender(B)
json.loads(c.withdraw_payout())
sync_balance(c)
set_sender(C)
json.loads(c.withdraw_payout())
sync_balance(c)
check("all three transfers recorded", len(TRANSFERS) == 3 and sum(v for _, v in TRANSFERS) == 101 * GEN, str(TRANSFERS))
check("invariant holds after all withdraws", invariant(c))
totals = json.loads(c.get_totals())
check("final: received == withdrawn == 101 GEN, credits 0, escrow 0",
      totals["total_received_wei"] == str(101 * GEN)
      and totals["total_withdrawn_wei"] == str(101 * GEN)
      and totals["credits_outstanding_wei"] == "0"
      and totals["escrow_locked_wei"] == "0", str(totals))

# ---------------------------------------------------------------------------
# 7. frozen path: round 2 disagrees -> stake back + 0.5 GEN reward, round 3 decides
# ---------------------------------------------------------------------------
print("== frozen / resolve path (challenge won) ==")
_Nondet.flag_queue = []
TRANSFERS.clear()
c2 = mf.MilestoneFund()
c2.__init__()
sync_balance(c2)
set_sender(A)
json.loads(c2.create_campaign("Test campaign", str(20 * GEN), json.dumps([{"title": "Only milestone", "amount": str(20 * GEN)}])))
set_sender(B, 20 * GEN)
json.loads(c2.back_campaign(0))
sync_balance(c2)
set_sender(A)
json.loads(c2.submit_milestone_proof(
    0, 0, "Borderline evidence: a prototype exists, see https://example.org/proto", "2026-11-09"))
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
r = json.loads(c2.review_milestone(0, 0))
check("frozen-path m0 pending ACCEPT", r["pending_verdict"] == "ACCEPT", str(r))
_Nondet.flag_queue = [["false", "false", "false"], ["false", "false", "false"]]
set_sender(B, 1 * GEN)
r = json.loads(c2.challenge_milestone(0, 0))
sync_balance(c2)
check("challenge WON_FROZEN, bond + 0.5 GEN reward credited, no settlement yet",
      r["challenge_outcome"] == "WON_FROZEN" and r["status"] == "FROZEN" and r["settlement"] is None, str(r))
check("B credit 1.5 GEN (stake + reward)", int(c2.get_credit(B)) == 15 * GEN // 10, str(c2.get_credit(B)))
camp2 = json.loads(c2.get_campaign(0))
check("escrow reduced by 0.5 GEN reward (19.5 GEN left)", camp2["escrow_wei"] == str(195 * GEN // 10), str(camp2))
check("settlement pool shrunk to 19.5 GEN", camp2["milestones"][0]["settlement_wei"] == str(195 * GEN // 10))
check("invariant holds while frozen", invariant(c2))
sup_b2 = json.loads(c2.get_supporter(B))
check("B challenges_won == 1", sup_b2["challenges_won"] == 1, str(sup_b2))
expect_error("confirm frozen rejected", lambda: c2.confirm_milestone(0, 0))
_Nondet.flag_queue = [["true", "false", "true"], ["true", "false", "true"]]
r = json.loads(c2.resolve_disputed_milestone(0, 0))
sync_balance(c2)
check("resolve final PARTIAL, witness keeps all 3 verdicts",
      r["final_verdict"] == "PARTIAL" and r["witness_verdicts"] == ["ACCEPT", "REJECT", "PARTIAL"], str(r))
check("resolve settlement 9.75/9.75 GEN (19.5 split)",
      r["settlement"]["released_wei"] == str(975 * GEN // 100) and r["settlement"]["refunded_wei"] == str(975 * GEN // 100), str(r))
check("B credit now 1.5 + 9.75 = 11.25 GEN", int(c2.get_credit(B)) == 1125 * GEN // 100, str(c2.get_credit(B)))
check("A credit 9.75 GEN", int(c2.get_credit(A)) == 975 * GEN // 100, str(c2.get_credit(A)))
camp2 = json.loads(c2.get_campaign(0))
check("frozen milestone PARTIAL_RELEASED, verdict immutable record kept",
      camp2["milestones"][0]["status"] == "PARTIAL_RELEASED"
      and camp2["milestones"][0]["final_verdict"] == "PARTIAL"
      and len(camp2["milestones"][0]["evaluations"]) == 3, str(camp2["milestones"][0]["status"]))
check("invariant holds after resolve", invariant(c2))
totals2 = json.loads(c2.get_totals())
check("frozen-path totals: received 21 GEN, credits 21 GEN",
      totals2["total_received_wei"] == str(21 * GEN) and totals2["credits_outstanding_wei"] == str(21 * GEN), str(totals2))
set_sender(B)
json.loads(c2.withdraw_payout())
sync_balance(c2)
set_sender(A)
json.loads(c2.withdraw_payout())
sync_balance(c2)
check("frozen-path withdraws pay out 21 GEN total", sum(v for _, v in TRANSFERS) == 21 * GEN, str(TRANSFERS))
check("invariant holds after frozen-path withdraws", invariant(c2))

# ---------------------------------------------------------------------------
# 8. staleness: evidence older than 30 days cannot be reviewed
# ---------------------------------------------------------------------------
print("== staleness gate ==")
_Nondet.flag_queue = []
c3 = mf.MilestoneFund()
c3.__init__()
set_sender(A)
json.loads(c3.create_campaign("Stale test", str(20 * GEN), json.dumps([{"title": "M", "amount": str(20 * GEN)}])))
set_sender(B, 20 * GEN)
json.loads(c3.back_campaign(0))
set_sender(A)
json.loads(c3.submit_milestone_proof(0, 0, "Old evidence text that is long enough here.", "2026-09-01"))
_Web.current_date = "2026-11-09"
expect_error("stale evidence (69 days) review raises before write",
             lambda: c3.review_milestone(0, 0))
camp3 = json.loads(c3.get_campaign(0))
check("stale milestone still EVIDENCE_SUBMITTED, nothing written",
      camp3["milestones"][0]["status"] == "EVIDENCE_SUBMITTED"
      and camp3["milestones"][0]["evaluations"] == [], str(camp3["milestones"][0]["status"]))
# fresh evidence on the boundary (exactly 30 days) reviews fine
json.loads(c3.submit_milestone_proof(0, 0, "Fresh evidence text that is long enough here.", "2026-10-10"))
_Nondet.flag_queue = [["true", "true", "true"], ["true", "true", "true"]]
r = json.loads(c3.review_milestone(0, 0))
check("30-day-old evidence reviews (boundary inclusive)", r["pending_verdict"] == "ACCEPT", str(r))
# future-dated evidence raises
c4 = mf.MilestoneFund()
c4.__init__()
set_sender(A)
json.loads(c4.create_campaign("Future test", str(20 * GEN), json.dumps([{"title": "M", "amount": str(20 * GEN)}])))
set_sender(B, 20 * GEN)
json.loads(c4.back_campaign(0))
set_sender(A)
json.loads(c4.submit_milestone_proof(0, 0, "Future evidence text that is long enough here.", "2026-11-10"))
expect_error("future-dated evidence review raises",
             lambda: c4.review_milestone(0, 0))
_Web.current_date = "2026-11-09"

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
