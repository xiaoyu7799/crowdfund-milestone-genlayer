// MilestoneFund frontend.
// Reads work without a wallet. Writes use an explicitly labelled in-browser
// password-encrypted browser signer with portable backup; an injected
// wallet (OKX first) is used only to connect and read as yourself.
// All money is real testnet GEN on Stable Studionet: backing a campaign
// sends GEN with the call, and settled money is pulled out with
// withdraw_payout. Get GEN free from the faucet first.
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { sealKey, openKey } from "./signer.js";
import { assertSuccessfulReceipt } from "../../scripts/receipt.mjs";
import { I18N } from "./i18n.js";
import { buildDossier } from "./dossier.js";

const CFG = window.MF_CONFIG;
const CHAIN_ID = 61999;
const GEN = 10n ** 18n;
const CHALLENGE_STAKE_WEI = 1n * GEN;
const EXPLORER_TX = "https://explorer-studio.genlayer.com/tx/";
const EXPLORER_ADDR = "https://explorer-studio.genlayer.com/address/";
const FAUCET_URL = "https://studio.genlayer.com/validators";

let lang = localStorage.getItem("mf-lang") || "en";
let campaigns = [];
let selectedId = 0;
let testAccount = null; // { address, client }
let walletAddress = null;
let walletChainOk = null;
// Gate 11: the last successful FINALIZED readback. Every displayed or
// exported value comes from here; before it exists, the page shows
// only "unconfirmed" placeholders and the dossier button stays disabled.
let lastReadback = null; // { campaigns, totals, readAt } | null

const $ = (id) => document.getElementById(id);
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");

// --- GEN / wei formatting (exact: BigInt, never floats) ----------------------
function parseGenToWei(text) {
  const s = String(text || "").trim();
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null;
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * GEN + BigInt(frac.padEnd(18, "0") || "0");
}

function fmtGen(wei) {
  const w = BigInt(wei);
  const whole = w / GEN;
  const frac = w % GEN;
  if (frac === 0n) return `${whole.toLocaleString("en-US")} GEN`;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(18, "0").replace(/0+$/, "")} GEN`;
}

function fmtWei(wei) {
  return `${BigInt(wei).toLocaleString("en-US")} wei`;
}

function fmtGenWei(wei) {
  return `${fmtGen(wei)} (${fmtWei(wei)})`;
}

// --- public read client (no account, no wallet needed) --------------------
const reader = createClient({ chain: studionet });

// --- story line: loading as narrative (E6) ---------------------------------
// The line always tells the truth about the real async step in progress.
function story(key, extra = "") {
  const el = $("story-line");
  el.textContent = t(key) + (extra ? ` ${extra}` : "");
  el.classList.remove("story-done");
  if (key === "story_finalized" || key === "story_ready") el.classList.add("story-done");
}

// --- transaction feed -------------------------------------------------------
function txFeedAdd(entry) {
  const feed = $("tx-feed");
  const empty = feed.querySelector(".tx-empty");
  if (empty) empty.remove();
  const row = document.createElement("div");
  row.className = "tx-row";
  const link = document.createElement("a");
  link.href = EXPLORER_TX + entry.hash;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = `${entry.hash.slice(0, 10)}…${entry.hash.slice(-6)}`;
  const label = document.createElement("span");
  label.textContent = entry.label + (entry.valueWei ? ` · ${fmtGenWei(entry.valueWei)}` : "");
  const status = document.createElement("span");
  status.className = "tx-status";
  status.textContent = entry.status;
  row.append(label, link, status);
  feed.prepend(row);
}

// --- reads ------------------------------------------------------------------
async function read(fn, args = []) {
  // Gate 11: reads must be FINALIZED. genlayer-js defaults readContract
  // to transactionHashVariant "latest-nonfinal", which can return state
  // from a transaction that has not finalized yet — so pin every read
  // to "latest-final". Verified live: latest-final returns the same
  // get_count / get_totals as the default on the current contract.
  const raw = await reader.readContract({ address: CFG.contractAddress, functionName: fn, args, transactionHashVariant: "latest-final" });
  if (typeof raw === "string") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

async function refreshAll() {
  story("story_loading");
  try {
    const count = Number(await read("get_count"));
    if (count === 0) {
      campaigns = [];
    } else {
      campaigns = await read("list_campaigns", [0n, 20n]);
    }
    const totals = await read("get_totals", []);
    // Only a completed readback may feed display or export.
    lastReadback = { campaigns, totals, readAt: new Date().toISOString() };
    $("btn-dossier").disabled = false;
    $("dossier-state").textContent = t("dossier_ready");
    if (campaigns.length > 0 && !campaigns.find((c) => c.id === selectedId)) selectedId = campaigns[0].id;
    renderCampaigns();
    await refreshBoard();
    await refreshMyStanding();
    story("story_ready");
  } catch (err) {
    story("story_error", humanError(err));
  }
}

async function refreshBoard() {
  const rows = await read("get_supporter_board", [10n]);
  const body = $("leaderboard-body");
  body.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.textContent = t("leaderboard_empty");
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    [
      String(i + 1) + ". " + shortAddr(r.address),
      fmtGen(r.backed_wei_total),
      String(r.milestones_completed_as_backer),
      `${r.challenges_won} / ${r.challenges_lost}`,
      fmtGen(r.credit_wei),
    ].forEach((v) => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

async function activeAddress() {
  return testAccount ? testAccount.address : walletAddress;
}

async function refreshMyStanding() {
  const addr = await activeAddress();
  const creditEl = $("my-credit");
  const backedEl = $("my-backed");
  const doneEl = $("my-completed");
  if (!addr) {
    creditEl.textContent = "—";
    backedEl.textContent = "—";
    doneEl.textContent = "—";
    return;
  }
  try {
    const sup = await read("get_supporter", [addr]);
    creditEl.textContent = fmtGenWei(sup.credit_wei);
    backedEl.textContent = fmtGen(sup.backed_wei_total);
    doneEl.textContent = `${sup.milestones_completed_as_backer} · ${t("challenges_label")} ${sup.challenges_won}/${sup.challenges_lost}`;
    $("btn-withdraw").disabled = BigInt(sup.credit_wei) === 0n;
    $("withdraw-preview").textContent = BigInt(sup.credit_wei) > 0n
      ? `${t("withdraw_preview")}: ${fmtGenWei(sup.credit_wei)}`
      : t("withdraw_empty");
  } catch {
    creditEl.textContent = "—";
    backedEl.textContent = "—";
    doneEl.textContent = "—";
  }
}

// --- rendering ---------------------------------------------------------------
function selectedCampaign() {
  return campaigns.find((c) => c.id === selectedId) || null;
}

function renderCampaigns() {
  const hero = $("hero-numbers");
  const camp = selectedCampaign();
  const picker = $("campaign-picker");
  picker.innerHTML = "";
  campaigns.forEach((c) => {
    const btn = document.createElement("button");
    btn.className = "picker-btn" + (c.id === selectedId ? " active" : "");
    btn.textContent = `#${c.id} ${c.title}`;
    btn.addEventListener("click", () => { selectedId = c.id; renderCampaigns(); refreshMyStanding(); });
    picker.appendChild(btn);
  });
  if (!camp) {
    hero.innerHTML = "";
    const p = document.createElement("p");
    p.className = "empty-note";
    p.textContent = t("no_campaigns");
    hero.appendChild(p);
    $("stages").innerHTML = "";
    $("back-box").style.display = "none";
    return;
  }
  $("back-box").style.display = "";
  // Cancel is available while the campaign has not started delivering:
  // FUNDING (creator or any backer) or MILESTONE_REVIEW with every
  // milestone still PENDING (creator only — the contract enforces it).
  const cancellable = camp.status === "FUNDING"
    || (camp.status === "MILESTONE_REVIEW" && camp.milestones.every((m) => m.status === "PENDING"));
  $("btn-cancel").style.display = cancellable ? "" : "none";
  hero.innerHTML = "";
  const raised = document.createElement("div");
  raised.className = "giant-number";
  raised.innerHTML = `<span class="giant-value">${fmtGen(camp.total_backed_wei)}</span>`;
  const goalLine = document.createElement("div");
  goalLine.className = "goal-line";
  goalLine.textContent = `${t("raised_label")} / ${t("goal_label")} ${fmtGen(camp.goal_wei)} · ${t("backers_label")} ${camp.backers.length} · ${t("escrow_label")} ${fmtGen(camp.escrow_wei)}`;
  const curtain = document.createElement("div");
  curtain.className = "curtain-track";
  const fill = document.createElement("div");
  fill.className = "curtain-fill";
  const pct = camp.goal_wei ? Math.min(1, Number(BigInt(camp.total_backed_wei) * 10000n / BigInt(camp.goal_wei)) / 10000) : 0;
  fill.style.transform = `scaleX(${pct})`;
  curtain.appendChild(fill);
  const title = document.createElement("h2");
  title.className = "campaign-title";
  title.textContent = `#${camp.id} ${camp.title}`;
  hero.append(title, raised, goalLine, curtain);
  renderStages(camp);
}

function milestoneCard(camp, m, index) {
  const card = document.createElement("article");
  // PARTIAL is its own visual state (amber), never the success style.
  card.className = "stage-card" + (m.status === "PARTIAL_RELEASED" ? " stage-partial" : "");
  const amount = document.createElement("div");
  amount.className = "stage-amount";
  amount.innerHTML = `<span class="stage-value">${fmtGen(m.amount)}</span><span class="stage-unit"> · ${fmtWei(m.amount)}</span>`;
  const title = document.createElement("h3");
  title.textContent = m.title;
  const status = document.createElement("p");
  status.className = "stage-status";
  // Exhaustive verdict branches: every contract state has its own line.
  // A pending verdict never shows money — only "unconfirmed".
  if (m.status === "PENDING" || m.status === "EVIDENCE_SUBMITTED") {
    status.textContent = t("status_" + m.status);
  } else if (m.status === "MILESTONE_REVIEW") {
    status.textContent = `${t("status_MILESTONE_REVIEW")} — ${t("pending_verdict_label")}: ${t("verdict_" + m.pending_verdict)} · ${t("pending_unconfirmed")}`;
  } else if (m.status === "FROZEN") {
    status.textContent = `${t("status_FROZEN")} — ${t("pending_verdict_label")}: ${t("verdict_" + m.pending_verdict)} · ${t("pending_unconfirmed")}`;
  } else {
    status.textContent = `${t("status_" + m.status)} — ${t("verdict_" + m.final_verdict)}`;
  }
  card.append(amount, title, status);
  if (m.reference_url) {
    const ref = document.createElement("p");
    ref.className = "stage-ref";
    const link = document.createElement("a");
    link.href = m.reference_url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = m.reference_url;
    ref.append(document.createTextNode(`${t("reference_label")}: `), link);
    card.appendChild(ref);
  }
  if (m.evidence_text) {
    const ev = document.createElement("blockquote");
    ev.className = "stage-evidence";
    ev.textContent = m.evidence_text;
    const hash = document.createElement("p");
    hash.className = "stage-hash";
    hash.textContent = `${t("evidence_hash_label")}: ${String(m.evidence_hash).slice(0, 18)}… (${m.evidence_date})`;
    card.append(ev, hash);
  }
  if (m.snapshot_hash) {
    const snap = document.createElement("p");
    snap.className = "stage-hash";
    snap.textContent = `${t("snapshot_hash_label")}: ${String(m.snapshot_hash).slice(0, 18)}… (${t("snapshot_len_label")}: ${m.snapshot_len})${m.github_sha ? ` · GitHub SHA ${String(m.github_sha).slice(0, 12)}…` : ""}`;
    card.appendChild(snap);
  }
  if (m.quote) {
    const q = document.createElement("blockquote");
    q.className = "stage-quote";
    q.textContent = `“${m.quote}”`;
    card.appendChild(q);
  }
  if (m.review_date) {
    const rd = document.createElement("p");
    rd.className = "stage-hash";
    rd.textContent = `${t("review_date_label")}: ${m.review_date} · ${t("confirm_available_label")}`;
    card.appendChild(rd);
  }
  if (m.evaluations && m.evaluations.length > 0) {
    const rounds = document.createElement("p");
    rounds.className = "stage-rounds";
    rounds.textContent = `${t("evaluations_label")}: ` + m.evaluations.map((e) => `R${e.round} ${e.verdict} [${e.flags.join(",")}]`).join(" · ");
    card.appendChild(rounds);
  }
  // Money is shown ONLY for settled milestones, from the readback.
  // A pending verdict shows "unconfirmed" and no amounts.
  if (["RELEASED", "REFUNDED", "PARTIAL_RELEASED"].includes(m.status)) {
    const money = document.createElement("p");
    money.className = "stage-money";
    money.textContent = `${t("released_label")} ${fmtGen(m.released_wei)} · ${t("refunded_label")} ${fmtGen(m.refunded_wei)}`;
    card.appendChild(money);
  } else if (m.status === "MILESTONE_REVIEW" || m.status === "FROZEN") {
    const money = document.createElement("p");
    money.className = "stage-money-unconfirmed";
    money.textContent = `${t("released_label")} ${t("pending_unconfirmed")} · ${t("refunded_label")} ${t("pending_unconfirmed")}`;
    card.appendChild(money);
  }
  const actions = document.createElement("div");
  actions.className = "stage-actions";
  const mkBtn = (label, fn) => {
    const b = document.createElement("button");
    b.className = "btn";
    b.textContent = label;
    b.addEventListener("click", fn);
    actions.appendChild(b);
  };
  if (camp.status === "MILESTONE_REVIEW" && (m.status === "PENDING" || m.status === "EVIDENCE_SUBMITTED")) {
    mkBtn(t("btn_submit_evidence"), () => openEvidenceForm(camp.id, index));
  }
  if (m.status === "EVIDENCE_SUBMITTED") mkBtn(t("btn_review"), () => doWrite("review_milestone", [BigInt(camp.id), index], "review", 0n));
  if (m.status === "MILESTONE_REVIEW") {
    mkBtn(t("btn_confirm"), () => doWrite("confirm_milestone", [BigInt(camp.id), index], "confirm", 0n));
    mkBtn(t("btn_challenge"), () => openChallengeForm(camp.id, index));
  }
  if (m.status === "FROZEN") mkBtn(t("btn_resolve"), () => doWrite("resolve_disputed_milestone", [BigInt(camp.id), index], "resolve", 0n));
  if (actions.children.length > 0) card.appendChild(actions);
  return card;
}

function renderStages(camp) {
  const wrap = $("stages");
  wrap.innerHTML = "";
  camp.milestones.forEach((m, i) => wrap.appendChild(milestoneCard(camp, m, i)));
}

// --- evidence form ------------------------------------------------------------
let evidenceTarget = null;
function openEvidenceForm(campaignId, index) {
  evidenceTarget = { campaignId, index };
  $("challenge-box").style.display = "none";
  $("evidence-box").style.display = "";
  $("evidence-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// --- challenge form -----------------------------------------------------------
let challengeTarget = null;
function openChallengeForm(campaignId, index) {
  challengeTarget = { campaignId, index };
  $("evidence-box").style.display = "none";
  $("challenge-box").style.display = "";
  $("challenge-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// --- dossier export (Gate 11: readback only) ----------------------------------
function downloadDossier() {
  try {
    if (!lastReadback) throw new Error(t("err_no_readback"));
    const camp = selectedCampaign();
    if (!camp) throw new Error(t("err_no_campaign"));
    const dossier = buildDossier({ campaign: camp, totals: lastReadback.totals, readAt: lastReadback.readAt });
    const blob = new Blob([JSON.stringify(dossier, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `milestonefund-dossier-campaign-${camp.id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    story("story_finalized");
  } catch (err) {
    story("story_error", humanError(err));
  }
}

// --- writes -------------------------------------------------------------------
function humanError(err) {
  const msg = String((err && err.message) || err);
  const m = msg.match(/EXPECTED: ([A-Z_0-9]+)/) || msg.match(/EXTERNAL: ([A-Z_0-9]+)/);
  if (m) return m[1].replaceAll("_", " ").toLowerCase();
  if (msg.includes("WRONG_NETWORK")) return t("wallet_chain_wrong");
  return msg.slice(0, 200);
}

async function requireWriter() {
  if (!CFG.writesEnabled) throw new Error("Updated contract deployment required; historical deployment is read-only.");
  if (!testAccount) throw new Error(t("err_need_test_account"));
  const chainId = Number(await testAccount.client.request({ method: "eth_chainId" }));
  if (chainId !== CHAIN_ID) throw new Error("WRONG_NETWORK");
  return testAccount.client;
}

async function doWrite(functionName, args, label, value = 0n) {
  try {
    const client = await requireWriter();
    if (value > 0n) {
      const bal = BigInt(await client.getBalance({ address: testAccount.address }));
      if (bal < value) { story("story_error", `${t("err_need_faucet")} (${fmtGenWei(value)})`); return; }
    }
    story("story_submitted");
    const hash = await client.writeContract({ address: CFG.contractAddress, functionName, args, value, leaderOnly: false });
    txFeedAdd({ hash, label, status: "submitted", valueWei: value > 0n ? value.toString() : null });
    story("story_waiting");
    const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 240, interval: 5000 });
    assertSuccessfulReceipt(receipt);
    txFeedAdd({ hash, label, status: receipt.statusName ?? "FINALIZED", valueWei: value > 0n ? value.toString() : null });
    story("story_finalized");
    await refreshAll();
  } catch (err) {
    story("story_error", humanError(err));
  }
}

// --- wallet -------------------------------------------------------------------
async function connectWallet() {
  const provider = window.okxwallet || window.ethereum;
  if (!provider) {
    story("story_error", t("no_wallet_note"));
    return;
  }
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const chainHex = await provider.request({ method: "eth_chainId" });
    walletAddress = accounts[0] || null;
    walletChainOk = parseInt(chainHex, 16) === CHAIN_ID;
    renderWallet();
    await refreshMyStanding();
  } catch (err) {
    story("story_error", humanError(err));
  }
}

async function switchNetwork() {
  const provider = window.okxwallet || window.ethereum;
  if (!provider) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0xF22F" }],
    });
  } catch (err) {
    if (err && err.code === 4902) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: "0xF22F",
          chainName: "GenLayer Stable Studionet",
          rpcUrls: ["https://studio.genlayer.com/api"],
          nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
          blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
        }],
      });
    } else {
      story("story_error", humanError(err));
    }
  }
  await connectWallet();
}

function renderWallet() {
  const el = $("wallet-state");
  el.innerHTML = "";
  const name = document.createElement("span");
  name.textContent = walletAddress
    ? `${t("wallet_connected_as")} ${shortAddr(walletAddress)} (${window.okxwallet ? "OKX Wallet" : "Injected EVM Wallet"})`
    : t("wallet_not_connected");
  el.appendChild(name);
  const chain = document.createElement("span");
  chain.className = "wallet-chain";
  chain.textContent = walletChainOk === null ? "" : walletChainOk ? t("wallet_chain_ok") : t("wallet_chain_wrong");
  el.appendChild(chain);
  $("btn-switch-network").style.display = walletChainOk === false ? "" : "none";
}

const SIGNER_STORE = "mf-encrypted-signer-v1";
async function enableTestAccount(imported = null) {
  try {
    const password = window.prompt(lang === "zh" ? "签名账号密码（至少12字符）；请保存密码及导出的加密备份。" : "Signer password (12+ characters). Keep your password and exported encrypted backup.");
    if (password === null) return;
    const existing = imported || JSON.parse(localStorage.getItem(SIGNER_STORE) || "null");
    const key = existing ? await openKey(existing, password) : generatePrivateKey();
    const account = createAccount(key);
    const backup = existing || await sealKey(key, password);
    localStorage.setItem(SIGNER_STORE, JSON.stringify(backup));
    testAccount = { address: account.address, client: createClient({ chain: studionet, account }) };
    $("test-account-state").textContent = `${t("test_account_enabled")}: ${account.address} — ${t("test_account_fund_hint")}`;
    $("btn-enable-test-account").disabled = true;
    await refreshMyStanding();
  } catch (err) { story("story_error", humanError(err)); }
}
function exportSigner() {
  const backup = localStorage.getItem(SIGNER_STORE);
  if (!backup) return;
  const url = URL.createObjectURL(new Blob([backup], {type: "application/json"}));
  const a = document.createElement("a"); a.href = url; a.download = "milestonefund-signer-encrypted.json"; a.click(); URL.revokeObjectURL(url);
}

// --- forms ----------------------------------------------------------------------
function bindForms() {
  $("btn-connect-wallet").addEventListener("click", connectWallet);
  $("btn-switch-network").addEventListener("click", switchNetwork);
  $("btn-enable-test-account").addEventListener("click", () => enableTestAccount());
  $("btn-export-signer").addEventListener("click", exportSigner);
  $("import-signer").addEventListener("change", async (event) => {
    try {
      const file = event.target.files[0];
      if (!file || file.size > 4096) throw new Error("Invalid signer backup");
      if (testAccount && !window.confirm("Replace the active signer? Export its backup first.")) return;
      await enableTestAccount(JSON.parse(await file.text()));
    } catch (err) { story("story_error", humanError(err)); }
    event.target.value = "";
  });
  $("btn-withdraw").addEventListener("click", async () => {
    await doWrite("withdraw_payout", [], "withdraw_payout", 0n);
  });
  $("back-amount").addEventListener("input", () => {
    const wei = parseGenToWei($("back-amount").value);
    $("back-preview").textContent = wei === null ? "" : `= ${fmtGenWei(wei)}`;
  });
  $("btn-create-campaign").addEventListener("click", async () => {
    const title = $("create-title").value.trim();
    const goalWei = parseGenToWei($("create-goal").value);
    const milestones = [];
    let ok = true;
    document.querySelectorAll(".milestone-row").forEach((row) => {
      const mt = row.querySelector(".m-title").value.trim();
      const ma = parseGenToWei(row.querySelector(".m-amount").value);
      if (mt && ma !== null) milestones.push({ title: mt, amount: ma.toString() });
      else if (mt || (row.querySelector(".m-amount").value || "").trim()) ok = false;
    });
    if (!title || goalWei === null || milestones.length === 0 || !ok) { story("story_error", t("err_need_amount")); return; }
    if (milestones.reduce((s, m) => s + BigInt(m.amount), 0n) !== goalWei) { story("story_error", t("err_sum_mismatch")); return; }
    if (goalWei % 2n !== 0n || milestones.some((m) => BigInt(m.amount) % 2n !== 0n)) { story("story_error", t("err_need_amount")); return; }
    await doWrite("create_campaign", [title, goalWei.toString(), JSON.stringify(milestones)], "create_campaign", 0n);
  });
  $("btn-back").addEventListener("click", async () => {
    const camp = selectedCampaign();
    if (!camp) { story("story_error", t("err_no_campaign")); return; }
    const amountWei = parseGenToWei($("back-amount").value);
    if (amountWei === null || amountWei <= 0n) { story("story_error", t("err_need_amount")); return; }
    await doWrite("back_campaign", [BigInt(camp.id)], "back_campaign", amountWei);
  });
  $("btn-submit-evidence").addEventListener("click", async () => {
    if (!evidenceTarget) return;
    const text = $("evidence-text").value.trim();
    const date = $("evidence-date").value;
    const url = $("evidence-url").value.trim();
    if (text.length < 20 || !date || !url.startsWith("https://")) { story("story_error", t("err_need_amount")); return; }
    await doWrite("submit_milestone_proof", [BigInt(evidenceTarget.campaignId), evidenceTarget.index, text, date, url], "submit_proof", 0n);
    $("evidence-box").style.display = "none";
  });
  $("btn-submit-challenge").addEventListener("click", async () => {
    if (!challengeTarget) return;
    const text = $("challenge-text").value.trim();
    const date = $("challenge-date").value;
    const url = $("challenge-url").value.trim();
    if (text.length < 20 || !date || !url.startsWith("https://")) { story("story_error", t("err_need_amount")); return; }
    await doWrite("challenge_milestone", [BigInt(challengeTarget.campaignId), challengeTarget.index, text, date, url], "challenge", CHALLENGE_STAKE_WEI);
    $("challenge-box").style.display = "none";
  });
  $("btn-cancel").addEventListener("click", async () => {
    const camp = selectedCampaign();
    if (!camp) { story("story_error", t("err_no_campaign")); return; }
    await doWrite("cancel_campaign", [BigInt(camp.id)], "cancel_campaign", 0n);
  });
  $("btn-dossier").addEventListener("click", downloadDossier);
  $("btn-lang").addEventListener("click", () => {
    lang = lang === "en" ? "zh" : "en";
    localStorage.setItem("mf-lang", lang);
    applyI18n();
    renderCampaigns();
    renderWallet();
  });
}

// --- i18n -----------------------------------------------------------------------
function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  $("btn-lang").textContent = lang === "en" ? "中文" : "EN";
  document.querySelectorAll("[data-i18n-href]").forEach((el) => {
    el.href = el.dataset.i18nHref;
  });
  // The story line is state, not a static label: a language toggle must
  // not reset it to "loading" after a FINALIZED readback exists.
  if (lastReadback) story("story_ready");
}

// --- boot -------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  // Footer link href stays in sync with config; the visible address text
  // is static HTML (docs/index.html) and JS never overwrites it, so no
  // bundle version can truncate it again.
  $("contract-link").href = EXPLORER_ADDR + CFG.contractAddress;
  $("source-link").href = CFG.repoUrl;
  $("network-note").textContent = "Stable Studionet · 61999";
  document.querySelectorAll(".faucet-link").forEach((el) => { el.href = FAUCET_URL; });
  $("evidence-date").value = new Date().toISOString().slice(0, 10);
  $("challenge-date").value = new Date().toISOString().slice(0, 10);
  $("dossier-state").textContent = t("dossier_disabled_note");
  applyI18n();
  bindForms();
  renderWallet();
  refreshAll();
});
