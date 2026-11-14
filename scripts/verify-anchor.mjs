// Read-only verification of the first-review anchor regression deployment.
import fs from 'node:fs';
import{createHash}from'node:crypto';
import{createClient}from'genlayer-js';import{studionet}from'genlayer-js/chains';
import{assertSuccessfulReceipt,receiptProof}from'./receipt.mjs';
const e=JSON.parse(fs.readFileSync('evidence/anchor-validation.json'));
if(!e.complete)throw Error('Anchor validation incomplete');
const c=createClient({chain:studionet}),code=fs.readFileSync('contracts/milestone_fund.py','utf8');
if(createHash('sha256').update(code).digest('hex')!==e.sourceSha256)throw Error('Source hash mismatch');
const raw=await c.request({method:'gen_getContractCode',params:[e.contractAddress]});if(raw!==code&&Buffer.from(raw,'base64').toString('utf8')!==code)throw Error('Deployed source mismatch');
for(const[label,t]of Object.entries(e.transactions)){
 if(!t.validated)throw Error('Unvalidated '+label);const r=await c.getTransaction({hash:t.hash});
 if(label==='resolve-changed'){if(receiptProof(r).status!=='FINALIZED'||!JSON.stringify(r).includes('original_evidence_changed'))throw Error('Missing anchor rejection');}
 else assertSuccessfulReceipt(r);
}
const total=JSON.parse(await c.readContract({address:e.contractAddress,functionName:'get_totals',args:[],transactionHashVariant:'latest-final'}));
if(!total.invariant_ok||total.contract_balance_wei!=='0'||total.credits_outstanding_wei!=='0'||total.escrow_locked_wei!=='0')throw Error('Unreconciled funds');
console.log(JSON.stringify({verified:true,contractAddress:e.contractAddress,sourceSha256:e.sourceSha256,transactions:Object.keys(e.transactions).length,totals:total},null,2));
