/* Targeted live paired-evidence checks. Default is a plan, never a transaction.
 * Persistent signers are loaded from MF_RECOVERY_FILE outside the repository.
 * Transaction hashes are journaled before waiting; reruns resume the same hash.
 * Every case stops on unexpected consensus or execution instead of relabelling it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createClient,createAccount} from 'genlayer-js';
import {studionet} from 'genlayer-js/chains';
import {TransactionStatus} from 'genlayer-js/types';
import {assertSuccessfulReceipt,receiptProof} from './receipt.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const stringify=x=>JSON.stringify(x,(k,v)=>typeof v==='bigint'?v.toString():v,2);
const scenarios = ["file and book stake", "failed zero-value adjudication preserves stake", "valid rebuttal settles", "expiry refunds and withdraws stake"];
if (!process.argv.includes("--submit")) {
 console.log(stringify({mode:"PLAN_ONLY", chainId:61999, scenarios}));
 process.exit(0);
}
const deployment=JSON.parse(fs.readFileSync(path.join(root,'evidence/two-stage/deployment.json'),'utf8'));
const source=fs.readFileSync(path.join(root,'contracts/milestone_fund.py'),'utf8');
const sourceSha=createHash('sha256').update(source).digest('hex');
if(sourceSha!==deployment.contractSha256) throw Error('A new matching deployment is required; no transaction submitted');
if(!process.env.MF_RECOVERY_FILE) throw Error('Persistent recovery signers required');
const recovery=JSON.parse(fs.readFileSync(process.env.MF_RECOVERY_FILE,'utf8'));
const accounts=Object.fromEntries(['creator','backer','stranger'].map(role=>[role,createAccount(recovery.keys[role])]));
const clients=Object.fromEntries(Object.entries(accounts).map(([role,account])=>[role,createClient({chain:studionet,account})]));
const reader=clients.backer;
if(Number(await reader.request({method:'eth_chainId'}))!==61999) throw Error('Wrong chain');
const address=deployment.contractAddress;
const deployed=await reader.request({method:'gen_getContractCode',params:[address]});
if(deployed!==source && Buffer.from(deployed,'base64').toString('utf8')!==source) throw Error('Deployed code differs from source');
const journalPath=path.join(root,'evidence/two-stage/validation.json');
fs.mkdirSync(path.join(root,'evidence/two-stage/receipts'),{recursive:true});
let evidence;
try {evidence=JSON.parse(fs.readFileSync(journalPath,'utf8'));} catch {evidence={network:'Stable Studionet',chainId:61999,contractAddress:address,sourceSha256:sourceSha,accounts:Object.fromEntries(Object.entries(accounts).map(([r,a])=>[r,a.address])),cases:{},transactions:{},checks:[],complete:false};}
if(evidence.contractAddress!==address||evidence.sourceSha256!==sourceSha) throw Error('Existing journal belongs to another deployment');
const save=()=>fs.writeFileSync(journalPath,stringify(evidence)+'\n');
const check=(name,condition)=>{ if(!condition) throw Error('CHECK FAILED: '+name); if(!evidence.checks.includes(name)) evidence.checks.push(name);save();console.log('PASS',name);};
async function read(functionName,args=[]) {
 const raw=await reader.readContract({address,functionName,args,transactionHashVariant:'latest-final'});
 return typeof raw==='string' && /^[{[]/.test(raw)?JSON.parse(raw):raw;
}
const campaign=id=>read('get_campaign',[BigInt(id)]);
async function snapshot(id,role) {return {campaign:id===null?null:await campaign(id),credit:String(await read('get_credit',[accounts.backer.address])),totals:await read('get_totals'),actualBalance:String(await reader.getBalance({address}))};}
async function step(label,role,functionName,args,value,id,verify,expectedError=null) {
 let record=evidence.transactions[label];
 if(record?.validated) return;
 if(!record) {record={role,functionName,args:JSON.parse(stringify(args)),valueWei:String(value),before:await snapshot(id,role)};evidence.transactions[label]=record;save();}
 if(!record.hash) {record.hash=await clients[role].writeContract({address,functionName,args,value,leaderOnly:false});record.status='SUBMITTED';save();console.log(label,record.hash);}
 const receipt=await reader.waitForTransactionReceipt({hash:record.hash,status:TransactionStatus.FINALIZED,retries:120,interval:5000});
 fs.writeFileSync(path.join(root,'evidence/two-stage/receipts',label+'.json'),stringify(receipt)+'\n');
 const currentProof=receiptProof(receipt);
 if(record.proof && JSON.stringify(record.proof)!==JSON.stringify(currentProof)) { record.proofHistory ||= [];record.proofHistory.push(record.proof); }
 record.proof=currentProof;record.status=currentProof.status;save();
 if(expectedError) {
  check(label+' finalized error',record.proof.status==='FINALIZED' && !record.proof.success && /ERROR/.test(record.proof.execution||''));
  check(label+' expected error',stringify(receipt).includes(expectedError));
 } else assertSuccessfulReceipt(receipt);
 const after=await snapshot(id,role);
 check(label+' actual balance reconciles', after.totals.invariant_ok &&
  BigInt(after.actualBalance) === BigInt(after.totals.escrow_locked_wei) +
   BigInt(after.totals.credits_outstanding_wei) + BigInt(after.totals.challenge_stakes_locked_wei));
 verify(record.before,after);record.after=after;record.validated=true;save();
}


const base='https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/463b0ac268e44952c3b9a5f41fe007f4f632d4f0/docs/evidence/paired/';
const GEN=10n**18n;
const today=()=>new Date().toISOString().slice(0,10);
const text='Controlled original or corrective sensor kit delivery evidence.';
const milestone=snapshot=>snapshot.campaign.milestones[0];
const pending=snapshot=>milestone(snapshot).pending_challenge;

async function prepare(label, counter) {
 if(evidence.cases[label]===undefined) { evidence.cases[label]=Number(await read('get_count'));save(); }
 const id=evidence.cases[label];
 const args=[BigInt(id),0];
 await step(label+'-create','creator','create_campaign',['Sensor kit delivery '+label,'2',JSON.stringify([{title:'Sensor kits assembled',amount:'2'}])],0n,null,()=>{});
 await step(label+'-back','backer','back_campaign',[BigInt(id)],2n,id,(_,a)=>check(label+' funded',a.campaign.backers.length===1));
 const proofDate=evidence.transactions[label+'-proof']?.args?.[3] ?? today();
 await step(label+'-proof','creator','submit_milestone_proof',[...args,text,proofDate,base+'original.md'],0n,id,(_,a)=>check(label+' proof stored',milestone(a).status==='EVIDENCE_SUBMITTED'));
 await step(label+'-review','backer','review_milestone',args,0n,id,(_,a)=>check(label+' round one ACCEPT',milestone(a).pending_verdict==='ACCEPT'));
 const fileDate=evidence.transactions[label+'-file']?.args?.[3] ?? today();
 await step(label+'-file','backer','file_challenge',[...args,text,fileDate,counter],GEN,id,(b,a)=>{
  check(label+' stake booked independently',pending(a)?.stake_wei===String(GEN) && BigInt(a.actualBalance)-BigInt(b.actualBalance)===GEN);
 });
 const filed=pending(evidence.transactions[label+'-file'].after);
 return {id,args:[...args,BigInt(filed.id)],milestoneArgs:args,expires:filed.expires_at};
}

if (BigInt(await reader.getBalance({address:accounts.backer.address})) < 3n*GEN) {
 await clients.backer.request({method:'sim_fundAccount',params:[accounts.backer.address,20*10**18]});
}

const valid=await prepare('valid',base+'counter.md');
await step('valid-adjudication','stranger','review_challenge',valid.args,0n,valid.id,(_,a)=>check('valid rebuttal freezes milestone',milestone(a).status==='FROZEN' && !pending(a) && milestone(a).challenge.challenger.toLowerCase()===accounts.backer.address.toLowerCase()));
await step('valid-resolve','backer','resolve_disputed_milestone',valid.milestoneArgs,0n,valid.id,(_,a)=>check('third round settles',milestone(a).status==='REFUNDED'));
await step('valid-withdraw','backer','withdraw_payout',[],0n,null,(_,a)=>check('settlement credits withdrawn',a.credit==='0' && a.actualBalance==='0'));

const expiry=await prepare('expiry',base+'missing-counter.md');
if (!evidence.transactions['expiry-failed-review']?.validated) {
 await step('expiry-failed-review','stranger','review_challenge',expiry.args,0n,expiry.id,(b,a)=>{
  check('failed review changes neither pending stake nor funds',stringify(pending(b))===stringify(pending(a)) && b.actualBalance===a.actualBalance && b.credit===a.credit);
 });
}
if (Date.now() < expiry.expires*1000) {
 evidence.expiryDue=new Date(expiry.expires*1000).toISOString(); save();
 console.log('Expiry is on-chain and not yet due:',evidence.expiryDue);
 process.exit(0);
}
await step('expiry-refund','stranger','refund_expired_challenge',expiry.args,0n,expiry.id,(b,a)=>check('permissionless expiry refunds challenger',!pending(a) && BigInt(a.credit)-BigInt(b.credit)===GEN));
await step('expiry-withdraw','backer','withdraw_payout',[],0n,null,(b,a)=>check('expired stake withdrawn',a.credit==='0' && BigInt(b.actualBalance)-BigInt(a.actualBalance)===GEN));
await step('expiry-confirm','backer','confirm_milestone',expiry.milestoneArgs,0n,expiry.id,(_,a)=>check('original verdict can settle after expiry',milestone(a).status==='RELEASED'));
await step('expiry-creator-withdraw','creator','withdraw_payout',[],0n,null,(_,a)=>check('final balance zero',a.actualBalance==='0' && a.totals.invariant_ok));
evidence.complete=true;save();
