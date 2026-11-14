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
const journalPath=path.join(root,'evidence/paired-validation.json');
fs.mkdirSync(path.join(root,'evidence/paired-receipts'),{recursive:true});
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
 fs.writeFileSync(path.join(root,'evidence/paired-receipts',label+'.json'),stringify(receipt)+'\n');
 const currentProof=receiptProof(receipt);
 if(record.proof && JSON.stringify(record.proof)!==JSON.stringify(currentProof)) { record.proofHistory ||= [];record.proofHistory.push(record.proof); }
 record.proof=currentProof;record.status=currentProof.status;save();
 if(expectedError) {
  check(label+' finalized error',record.proof.status==='FINALIZED' && !record.proof.success && /ERROR/.test(record.proof.execution||''));
  check(label+' expected error',stringify(receipt).includes(expectedError));
 } else assertSuccessfulReceipt(receipt);
 const after=await snapshot(id,role); verify(record.before,after);record.after=after;record.validated=true;save();
}
const fixtureRef=process.env.MF_FIXTURE_REF;
if(!fixtureRef || !/^[0-9a-f]{40}$/.test(fixtureRef)) throw Error('Set MF_FIXTURE_REF to a published immutable fixture commit before live writes');
if(evidence.fixtureCommit && evidence.fixtureCommit!==fixtureRef) throw Error('Fixture commit differs from journal');
evidence.fixtureCommit=fixtureRef; save();
for(const role of Object.keys(accounts)) {
 const balance=BigInt(await clients[role].getBalance({address:accounts[role].address}));
 if(balance<10n**19n && !evidence.funding?.[role]) {
  const result=await clients[role].request({method:'sim_fundAccount',params:[accounts[role].address,100*10**18]});
  evidence.funding ||= {};evidence.funding[role]={result:String(result)};save();
 }
}
const base=`https://raw.githubusercontent.com/xiaoyu7799/crowdfund-milestone-genlayer/${fixtureRef}/docs/evidence/paired/`;
evidence.evidenceDate ||= new Date().toISOString().slice(0,10); save();
const date=evidence.evidenceDate,GEN=10n**18n;
const proofText='Controlled test evidence for sensor kit delivery; validators must fetch the reference.';
for(const [name,amounts] of [['paired',[2n,2n*GEN]]]) {
 if(!evidence.cases[name]) {evidence.cases[name]={id:Number(await read('get_count'))};save();}
 const id=evidence.cases[name].id,goal=amounts.reduce((a,b)=>a+b,0n);
 await step(name+'-create','creator','create_campaign',[`Paired evidence ${name}`,String(goal),stringify(amounts.map(amount=>({title:'Sensor kits assembled',amount:String(amount)})))],0n,null,()=>{});
 check(name+' creator and allocation', (await campaign(id)).creator.toLowerCase()===accounts.creator.address.toLowerCase() && (await campaign(id)).goal_wei===String(goal));
 await step(name+'-self-back','creator','back_campaign',[BigInt(id)],goal,id,(before,after)=>{check(name+' self-back full credit',BigInt(after.credit)-BigInt(before.credit)===goal);check(name+' self-back no campaign change',stringify(before.campaign)===stringify(after.campaign));});
 await step(name+'-back','backer','back_campaign',[BigInt(id)],goal,id,(before,after)=>check(name+' sole independent backer',after.campaign.status==='MILESTONE_REVIEW' && after.campaign.backers.length===1));
 for(let index=0;index<amounts.length;index++) {
  const label=`${name}-m${index}`;
  await step(label+'-proof','creator','submit_milestone_proof',[BigInt(id),index,proofText,date,base+'original.md'],0n,id,(b,a)=>check(label+' proof stored',a.campaign.milestones[index].status==='EVIDENCE_SUBMITTED'));
  if(index===0) await step(label+'-creator-review','creator','review_milestone',[BigInt(id),index],0n,id,(b,a)=>check(label+' creator review unchanged',stringify(b.campaign)===stringify(a.campaign)),'creator_cannot_review_own_milestone');
  await step(label+'-review','backer','review_milestone',[BigInt(id),index],0n,id,(b,a)=>check(label+' original ACCEPT pending',a.campaign.milestones[index].pending_verdict==='ACCEPT' && a.campaign.milestones[index].status==='MILESTONE_REVIEW'));
  if(index===0) for(const file of ['unrelated','corroboration','original']) await step(label+'-reject-'+file,'backer','challenge_milestone',[BigInt(id),index,proofText,date,base+file+'.md'],GEN,id,(b,a)=>{check(label+' '+file+' stake refunded',BigInt(a.credit)-BigInt(b.credit)===GEN);check(label+' '+file+' campaign unchanged',stringify(b.campaign)===stringify(a.campaign));});
  await step(label+'-challenge','backer','challenge_milestone',[BigInt(id),index,proofText,date,(process.env.MF_COUNTER_URL || base+'counter.md')],GEN,id,(b,a)=>{
   const m=a.campaign.milestones[index],ev=m.evaluations.at(-1),reward=BigInt(m.challenge?.reward_wei||0);
   check(label+' genuine rebuttal freezes',m.status==='FROZEN' && m.challenge.outcome==='WON_FROZEN' && m.challenge.second_verdict==='REJECT');
   check(label+' reward capped',reward===(amounts[index]<GEN/2n?amounts[index]:GEN/2n) && BigInt(a.credit)-BigInt(b.credit)===GEN+reward);
   check(label+' paired witnesses',ev.rebuts_original==='true' && /^[a-f0-9]{64}$/.test(ev.original_snapshot_hash) && ev.original_snapshot_hash!==ev.snapshot_hash && !!ev.original_quote);
   check(label+' other milestone untouched',a.campaign.milestones.every((other,i)=>i===index||stringify(other)===stringify(b.campaign.milestones[i])));
   check(label+' escrow exact',BigInt(b.campaign.escrow_wei)-BigInt(a.campaign.escrow_wei)===reward);
  });
  await step(label+'-resolve','backer','resolve_disputed_milestone',[BigInt(id),index],0n,id,(b,a)=>check(label+' sole backer resolves REJECT',a.campaign.milestones[index].status==='REFUNDED' && a.campaign.milestones[index].final_verdict==='REJECT'));
 }
 check(name+' escrow fully allocated',(await campaign(id)).escrow_wei==='0');
}
for(const role of Object.keys(accounts)) if(BigInt(await read('get_credit',[accounts[role].address]))>0n || evidence.transactions['withdraw-'+role]) await step('withdraw-'+role,role,'withdraw_payout',[],0n,null,(b,a)=>check(role+' credit withdrawn',BigInt(a.credit)===0n));
evidence.finalTotals=await read('get_totals');
check('final reconciliation',evidence.finalTotals.invariant_ok===true && evidence.finalTotals.escrow_locked_wei==='0' && evidence.finalTotals.credits_outstanding_wei==='0' && evidence.finalTotals.contract_balance_wei==='0');
evidence.complete=true;save();console.log('LIVE VALIDATION COMPLETE');
