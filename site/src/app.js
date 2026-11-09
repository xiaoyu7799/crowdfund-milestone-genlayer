// MilestoneFund frontend.
// Reads work without a wallet. Writes use an explicitly labelled in-browser
// temporary test account (key never leaves browser memory); an injected
// wallet (OKX first) is used only to connect and read as yourself.
import { createClient, createAccount, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import { I18N } from "./i18n.js";

const CFG = window.MF_CONFIG;
const CHAIN_ID = 61999;
const EXPLORER_TX = "https://explorer-studio.genlayer.com/tx/";
const EXPLORER_ADDR = "https://explorer-studio.genlayer.com/address/";

let lang = localStorage.getItem("mf-lang") || "en";
let campaigns = [];
let selectedId = 0;
let testAccount = null; // { address, client }
let walletAddress = null;
let walletChainOk = null;

const $ = (id) => document.getElementById(id);
const t = (key) => (I18N[lang] && I18N[lang][key]) || I18N.en[key] || key;
const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
const fmt = (n) => Number(n).toLocaleString("en-US");

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
  label.textContent = entry.label;
  const status = document.createElement("span");
  status.className = "tx-status";
  status.textContent = entry.status;
  row.append(label, link, status);
  feed.prepend(row);
}

// --- reads ------------------------------------------------------------------
async function read(fn, args = []) {
  const raw = await reader.readContract({ address: CFG.contractAddress, functionName: fn, args });
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
    if (campaigns.length > 0 && !campaigns.find((c) => c.id === selectedId)) selectedId = campaigns[0].id;
    renderCampaigns();
    await refreshLeaderboard();
    await refreshMyBalance();
    story("story_ready");
  } catch (err) {
    story("story_error", humanError(err));
  }
}

async function refreshLeaderboard() {
  const rows = await read("get_leaderboard", [10n]);
  const body = $("leaderboard-body");
  body.innerHTML = "";
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = t("leaderboard_empty");
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    [String(i + 1) + ". " + shortAddr(r.address), String(r.reputation), fmt(r.total_backed), fmt(r.balance)]
      .forEach((v) => {
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

async function refreshMyBalance() {
  const addr = await activeAddress();
  const el = $("my-balance");
  const repEl = $("my-reputation");
  if (!addr) {
    el.textContent = "—";
    repEl.textContent = "—";
    return;
  }
  try {
    const bal = await read("get_balance", [addr]);
    el.textContent = fmt(bal.balance) + " mGEN";
    repEl.textContent = bal.reputation === null || bal.reputation === undefined ? "100" : String(bal.reputation);
  } catch {
    el.textContent = "—";
    repEl.textContent = "—";
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
    btn.addEventListener("click", () => { selectedId = c.id; renderCampaigns(); refreshMyBalance(); });
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
  hero.innerHTML = "";
  const raised = document.createElement("div");
  raised.className = "giant-number";
  raised.innerHTML = `<span class="giant-value">${fmt(camp.total_backed)}</span><span class="giant-unit"> mGEN</span>`;
  const goalLine = document.createElement("div");
  goalLine.className = "goal-line";
  goalLine.textContent = `${t("raised_label")} / ${t("goal_label")} ${fmt(camp.goal)} · ${t("backers_label")} ${camp.backers.length} · ${t("escrow_label")} ${fmt(camp.escrow)} mGEN`;
  const curtain = document.createElement("div");
  curtain.className = "curtain-track";
  const fill = document.createElement("div");
  fill.className = "curtain-fill";
  fill.style.transform = `scaleX(${camp.goal ? Math.min(1, camp.total_backed / camp.goal) : 0})`;
  curtain.appendChild(fill);
  const title = document.createElement("h2");
  title.className = "campaign-title";
  title.textContent = `#${camp.id} ${camp.title}`;
  hero.append(title, raised, goalLine, curtain);
  renderStages(camp);
}

function milestoneCard(camp, m, index) {
  const card = document.createElement("article");
  card.className = "stage-card";
  const amount = document.createElement("div");
  amount.className = "stage-amount";
  amount.innerHTML = `<span class="stage-value">${fmt(m.amount)}</span><span class="stage-unit"> mGEN</span>`;
  const title = document.createElement("h3");
  title.textContent = m.title;
  const status = document.createElement("p");
  status.className = "stage-status";
  status.textContent = `${t("status_" + m.status)}${m.final_verdict ? ` — ${t("verdict_" + m.final_verdict)}` : ""}${m.pending_verdict ? ` — ${t("pending_verdict_label")}: ${t("verdict_" + m.pending_verdict)}` : ""}`;
  card.append(amount, title, status);
  if (m.evidence_text) {
    const ev = document.createElement("blockquote");
    ev.className = "stage-evidence";
    ev.textContent = m.evidence_text;
    const hash = document.createElement("p");
    hash.className = "stage-hash";
    hash.textContent = `${t("evidence_hash_label")}: ${String(m.evidence_hash).slice(0, 18)}… (${m.evidence_date})`;
    card.append(ev, hash);
  }
  if (m.evaluations && m.evaluations.length > 0) {
    const rounds = document.createElement("p");
    rounds.className = "stage-rounds";
    rounds.textContent = `${t("evaluations_label")}: ` + m.evaluations.map((e) => `R${e.round} ${e.verdict} [${e.flags.join(",")}]`).join(" · ");
    card.appendChild(rounds);
  }
  if (m.status === "FINALIZED") {
    const money = document.createElement("p");
    money.className = "stage-money";
    money.textContent = `${t("released_label")} ${fmt(m.released)} · ${t("refunded_label")} ${fmt(m.refunded)}`;
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
  if (camp.status === "FUNDED" && (m.status === "PENDING" || m.status === "EVIDENCE_SUBMITTED")) {
    mkBtn(t("btn_submit_evidence"), () => openEvidenceForm(camp.id, index));
  }
  if (m.status === "EVIDENCE_SUBMITTED") mkBtn(t("btn_evaluate"), () => doWrite("evaluate_milestone", [BigInt(camp.id), index], "evaluate"));
  if (m.status === "EVALUATING") {
    mkBtn(t("btn_finalize"), () => doWrite("finalize_milestone", [BigInt(camp.id), index], "finalize"));
    mkBtn(t("btn_challenge"), () => doWrite("challenge_milestone", [BigInt(camp.id), index], "challenge"));
  }
  if (m.status === "FROZEN") mkBtn(t("btn_resolve"), () => doWrite("resolve_frozen", [BigInt(camp.id), index], "resolve"));
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
  $("evidence-box").style.display = "";
  $("evidence-box").scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  if (!testAccount) throw new Error(t("err_need_test_account"));
  const chainId = Number(await testAccount.client.request({ method: "eth_chainId" }));
  if (chainId !== CHAIN_ID) throw new Error("WRONG_NETWORK");
  return testAccount.client;
}

async function doWrite(functionName, args, label) {
  try {
    const client = await requireWriter();
    story("story_submitted");
    const hash = await client.writeContract({ address: CFG.contractAddress, functionName, args, value: 0n, leaderOnly: false });
    txFeedAdd({ hash, label, status: "submitted" });
    story("story_waiting");
    const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 240, interval: 5000 });
    txFeedAdd({ hash, label, status: receipt.statusName ?? "FINALIZED" });
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
    await refreshMyBalance();
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

function enableTestAccount() {
  const key = generatePrivateKey();
  const account = createAccount(key);
  testAccount = { address: account.address, client: createClient({ chain: studionet, account }) };
  $("test-account-state").textContent = `${t("test_account_enabled")}: ${shortAddr(account.address)}`;
  $("btn-enable-test-account").disabled = true;
  refreshMyBalance();
}

// --- forms ----------------------------------------------------------------------
function bindForms() {
  $("btn-connect-wallet").addEventListener("click", connectWallet);
  $("btn-switch-network").addEventListener("click", switchNetwork);
  $("btn-enable-test-account").addEventListener("click", enableTestAccount);
  $("btn-claim-demo").addEventListener("click", async () => {
    try {
      const client = await requireWriter();
      story("story_submitted");
      const hash = await client.writeContract({ address: CFG.contractAddress, functionName: "claim_demo_funds", args: [], value: 0n, leaderOnly: false });
      txFeedAdd({ hash, label: "claim_demo_funds", status: "submitted" });
      await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, retries: 120, interval: 5000 });
      story("story_finalized", t("claim_done"));
      await refreshAll();
    } catch (err) {
      story("story_error", humanError(err));
    }
  });
  $("btn-create-campaign").addEventListener("click", async () => {
    const title = $("create-title").value.trim();
    const goal = Number($("create-goal").value);
    const milestones = [];
    let ok = true;
    document.querySelectorAll(".milestone-row").forEach((row) => {
      const mt = row.querySelector(".m-title").value.trim();
      const ma = Number(row.querySelector(".m-amount").value);
      if (mt && ma > 0) milestones.push({ title: mt, amount: ma });
    });
    if (!title || !goal || milestones.length === 0) { story("story_error", t("err_need_amount")); return; }
    if (milestones.reduce((s, m) => s + m.amount, 0) !== goal) { story("story_error", "milestone amounts must sum to goal"); return; }
    await doWrite("create_campaign", [title, goal, JSON.stringify(milestones)], "create_campaign");
  });
  $("btn-back").addEventListener("click", async () => {
    const camp = selectedCampaign();
    if (!camp) { story("story_error", t("err_no_campaign")); return; }
    const amount = Number($("back-amount").value);
    if (!amount || amount <= 0 || amount % 2 !== 0) { story("story_error", t("err_need_amount")); return; }
    await doWrite("back", [BigInt(camp.id), amount], "back");
  });
  $("btn-submit-evidence").addEventListener("click", async () => {
    if (!evidenceTarget) return;
    const text = $("evidence-text").value.trim();
    const date = $("evidence-date").value;
    if (text.length < 20 || !date) { story("story_error", t("err_need_amount")); return; }
    await doWrite("submit_milestone_evidence", [BigInt(evidenceTarget.campaignId), evidenceTarget.index, text, date], "submit_evidence");
    $("evidence-box").style.display = "none";
  });
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
}

// --- boot -------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  $("contract-link").href = EXPLORER_ADDR + CFG.contractAddress;
  $("contract-link").textContent = shortAddr(CFG.contractAddress);
  $("source-link").href = CFG.repoUrl;
  $("network-note").textContent = "Stable Studionet · 61999";
  $("evidence-date").value = new Date().toISOString().slice(0, 10);
  applyI18n();
  bindForms();
  renderWallet();
  refreshAll();
});
