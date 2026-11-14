import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertSuccessfulReceipt,receiptProof} from '../scripts/receipt.mjs';
const valid = {status:7,result_name:'MAJORITY_AGREE',consensus_data:{leader_receipt:[{execution_result:'SUCCESS',genvm_result:{raw_error:null}}]}};
test('Stable raw and normalized successful receipts',()=>{
 assert.equal(assertSuccessfulReceipt(valid).success,true);
 assert.equal(assertSuccessfulReceipt({statusName:'FINALIZED',resultName:'MAJORITY_AGREE',txExecutionResultName:'FINISHED_WITH_RETURN'}).success,true);
});
test('finality alone and failed or undetermined consensus never count as success',()=>{
 for(const bad of [{status:7},{...valid,status:5},{...valid,result_name:'NO_MAJORITY'},{...valid,consensus_data:{leader_receipt:[{execution_result:'ERROR'}]}},{...valid,consensus_data:{leader_receipt:[{execution_result:'SUCCESS',genvm_result:{raw_error:'execution failed'}}]}}]) {
  assert.equal(receiptProof(bad).success,false); assert.throws(()=>assertSuccessfulReceipt(bad));
 }
});

test('actual leader execution is distinct from a trailing quorum-cancelled validator',()=>{
 const receipt={status:7,result_name:'MAJORITY_AGREE',consensus_data:{leader_receipt:[
  {mode:'leader',execution_result:'SUCCESS',genvm_result:{raw_error:null}},
  {mode:'validator',execution_result:'ERROR',genvm_result:{raw_error:{causes:['VALIDATOR_QUORUM_REACHED']}}}
 ]}};
 assert.equal(assertSuccessfulReceipt(receipt).success,true);
 receipt.consensus_data.leader_receipt[0].execution_result='ERROR';
 receipt.consensus_data.leader_receipt[1].execution_result='SUCCESS';
 assert.throws(()=>assertSuccessfulReceipt(receipt));
});
