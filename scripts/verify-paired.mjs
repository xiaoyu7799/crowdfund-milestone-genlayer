// Read-only verification of the paired-evidence live journal. No writes.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createClient} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {assertSuccessfulReceipt,receiptProof} from './receipt.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const e=JSON.parse(fs.readFileSync(path.join(root,'evidence/paired-validation.json'),'utf8'));
if(!e.complete) throw Error('Live journal is incomplete; verification cannot pass');
const code=fs.readFileSync(path.join(root,'contracts/milestone_fund.py'),'utf8');
if(createHash('sha256').update(code).digest('hex')!==e.sourceSha256) throw Error('Source changed after live validation');
const c=createClient({chain:studionet});
if(Number(await c.request({method:'eth_chainId'}))!==61999) throw Error('Wrong chain');
const deployed=await c.request({method:'gen_getContractCode',params:[e.contractAddress]});
if(deployed!==code && Buffer.from(deployed,'base64').toString('utf8')!==code) throw Error('Deployed code mismatch');
async function read(functionName,args=[]) {
 const raw=await c.readContract({address:e.contractAddress,functionName,args,transactionHashVariant:'latest-final'});
 return typeof raw==='string' && /^[{[]/.test(raw)?JSON.parse(raw):raw;
}
for(const [label,record] of Object.entries(e.transactions)) {
 if(!record.validated||!record.hash) throw Error('Unvalidated transaction '+label);
 const receipt=await c.getTransaction({hash:record.hash});
 if(label.endsWith('-creator-review')) {
  const proof=receiptProof(receipt);
  if(proof.status!=='FINALIZED'||proof.success||!/ERROR/.test(proof.execution||'')) throw Error('Invalid negative receipt '+label);
 } else assertSuccessfulReceipt(receipt);
}
for(const [name,entry] of Object.entries(e.cases)) {
 const campaign=await read('get_campaign',[BigInt(entry.id)]);
 if(campaign.escrow_wei!=='0'||campaign.backers.length!==1) throw Error('Campaign not reconciled '+name);
 for(const m of campaign.milestones) if(m.final_verdict!=='REJECT'||m.status!=='REFUNDED'||m.evaluations.length!==3||!m.evaluations[1].original_snapshot_hash||!m.evaluations[2].original_snapshot_hash) throw Error('Missing settled paired evidence '+name);
}
const totals=await read('get_totals');
if(!totals.invariant_ok||totals.credits_outstanding_wei!=='0'||totals.escrow_locked_wei!=='0'||totals.contract_balance_wei!=='0') throw Error('Money reconciliation failed');
console.log(JSON.stringify({verified:true,contractAddress:e.contractAddress,transactions:Object.keys(e.transactions).length,totals},null,2));
