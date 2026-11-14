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
const scenarios=['creator self-backing refund','creator review refusal','independent sole backer review','unrelated page refund','corroboration without rebuttal refund','identical snapshot replay refund','genuine rebuttal compared with original','tiny reward bounded by milestone; other milestone unchanged','single backer dispute resolution','withdrawals and accounting reconciliation'];
if(!process.argv.includes('--submit')) { console.log(stringify({mode:'PLAN_ONLY',chainId:61999,scenarios,transactionsSubmitted:0})); process.exit(0); }
const deployment=JSON.parse(fs.readFileSync(path.join(root,'deployment.json'),'utf8'));
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
const journalPath=path.join(root,'evidence/anchor-validation.json');
fs.mkdirSync(path.join(root,'evidence/anchor-receipts'),{recursive:true});
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
async function snapshot(id,role) {return {campaign:id===null?null:await campaign(id),credit:String(await read('get_credit',[accounts[role].address]))};}
async function step(label,role,functionName,args,value,id,verify,expectedError=null) {
 let record=evidence.transactions[label];
 if(record?.validated) return;
 if(!record) {record={role,functionName,args:JSON.parse(stringify(args)),valueWei:String(value),before:await snapshot(id,role)};evidence.transactions[label]=record;save();}
 if(!record.hash) {record.hash=await clients[role].writeContract({address,functionName,args,value,leaderOnly:false});record.status='SUBMITTED';save();console.log(label,record.hash);}
 const receipt=await reader.waitForTransactionReceipt({hash:record.hash,status:TransactionStatus.FINALIZED,retries:120,interval:5000});
 fs.writeFileSync(path.join(root,'evidence/anchor-receipts',label+'.json'),stringify(receipt)+'\n');
 const currentProof=receiptProof(receipt);
 if(record.proof && JSON.stringify(record.proof)!==JSON.stringify(currentProof)) { record.proofHistory ||= [];record.proofHistory.push(record.proof); }
 record.proof=currentProof;record.status=currentProof.status;save();
 if(expectedError) {
  check(label+' finalized error',record.proof.status==='FINALIZED' && !record.proof.success && /ERROR/.test(record.proof.execution||''));
  check(label+' expected error',stringify(receipt).includes(expectedError));
 } else assertSuccessfulReceipt(receipt);
 const after=await snapshot(id,role); verify(record.before,after);record.after=after;record.validated=true;save();
}

const stage=process.env.MF_ANCHOR_STAGE;
const original=process.env.MF_ORIGINAL_URL;
const counter='https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/463b0ac268e44952c3b9a5f41fe007f4f632d4f0/docs/evidence/paired/counter.md';
const GEN=10n**18n;const date=new Date().toISOString().slice(0,10);
const text='Controlled original or corrective sensor kit delivery evidence.';
if(!original)throw Error('Original URL required');
if(stage==='prepare') {
 const balance=BigInt(await reader.getBalance({address:accounts.backer.address}));if(balance<3n*GEN)throw Error('Fund persistent backer first');
 evidence.caseId ??= Number(await read('get_count'));save();const id=evidence.caseId;
 await step('create','creator','create_campaign',['Anchored sensor evidence','2',JSON.stringify([{title:'Sensor kits assembled',amount:'2'}])],0n,null,()=>{});
 await step('back','backer','back_campaign',[BigInt(id)],2n,id,(b,a)=>check('independent backing',a.campaign.backers.length===1));
 await step('proof','creator','submit_milestone_proof',[BigInt(id),0,text,date,original],0n,id,(b,a)=>check('proof stored',a.campaign.milestones[0].status==='EVIDENCE_SUBMITTED'));
 await step('review','backer','review_milestone',[BigInt(id),0],0n,id,(b,a)=>check('round one anchored',a.campaign.milestones[0].pending_verdict==='ACCEPT'));
} else {
 const id=evidence.caseId;if(id===undefined)throw Error('Prepare first');
 if(stage==='challenge-changed')await step(stage,'backer','challenge_milestone',[BigInt(id),0,text,date,counter],GEN,id,(b,a)=>{check('changed original refunds stake',BigInt(a.credit)-BigInt(b.credit)===GEN);check('changed original preserves campaign',stringify(b.campaign)===stringify(a.campaign));});
 else if(stage==='freeze')await step(stage,'backer','challenge_milestone',[BigInt(id),0,text,date,counter],GEN,id,(b,a)=>{check('unchanged original permits freeze',a.campaign.milestones[0].status==='FROZEN');check('reward bounded at two wei',a.campaign.milestones[0].challenge.reward_wei==='2');});
 else if(stage==='resolve-changed')await step(stage,'backer','resolve_disputed_milestone',[BigInt(id),0],0n,id,(b,a)=>check('changed original prevents settlement',stringify(b.campaign)===stringify(a.campaign)),'original_evidence_changed');
 else if(stage==='settle'){
 await step('resolve','backer','resolve_disputed_milestone',[BigInt(id),0],0n,id,(b,a)=>check('restored anchor settles',a.campaign.milestones[0].status==='REFUNDED'));
 await step('withdraw','backer','withdraw_payout',[],0n,null,(b,a)=>check('withdrawn',a.credit==='0'));
 evidence.finalTotals=await read('get_totals');check('actual balance reconciled',evidence.finalTotals.contract_balance_wei==='0'&&evidence.finalTotals.escrow_locked_wei==='0'&&evidence.finalTotals.credits_outstanding_wei==='0');evidence.complete=true;save();
 } else throw Error('Unknown stage');
}
