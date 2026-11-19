// MilestoneFund site config. Filled in after deployment; the contract
// default address matches evidence/two-stage/deployment.json.
window.MF_CONFIG = {
  contractAddress: "0x593fF4e4E5b5F73d34c7C29509D75E8B537EC853",
  repoUrl: "https://github.com/xiaoyu7799/crowdfund-milestone-genlayer",
  twoStageChallenges: true,
  writesEnabled: true, // Current deployment; writes enabled after live validation.
  chainId: 61999,
  rpcUrl: "https://studio.genlayer.com/api",
};

if (new URLSearchParams(window.location.search).get("version") === "accepted") {
  window.MF_CONFIG.contractAddress = "0xF49D710b0bBB23058D2ED08d141b2E28a4a9A692";
  window.MF_CONFIG.twoStageChallenges = false;
}
