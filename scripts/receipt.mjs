// Stable Studionet raw receipts and SDK-normalized receipts use different names.
export function receiptProof(receipt) {
  const status = receipt.statusName ?? ({7:'FINALIZED'})[receipt.status];
  const raw = receipt.consensus_data?.leader_receipt;
  const leaders = (Array.isArray(raw) ? raw : raw ? [raw] : []);
  const leader = leaders.at(-1);
  const execution = leader?.execution_result ?? receipt.txExecutionResultName;
  const consensus = receipt.result_name ?? receipt.resultName;
  const executionSucceeded = execution === 'SUCCESS' || execution === 'FINISHED_WITH_RETURN';
  const consensusSucceeded = ['MAJORITY_AGREE','AGREE','SUCCESS'].includes(consensus);
  return { status, execution, consensus, success: status === 'FINALIZED' && executionSucceeded && consensusSucceeded && !leader?.genvm_result?.raw_error };
}
export function assertSuccessfulReceipt(receipt) {
  const proof = receiptProof(receipt);
  if (!proof.success) throw new Error(`Transaction not finalized successfully: ${JSON.stringify(proof)}`);
  return proof;
}
