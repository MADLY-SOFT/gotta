'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
const {syncPlayerProjection,verifyPlayerProjections}=require('../lib/player-projection');
const ROOT=path.resolve(__dirname,'..');

async function unusedPort(){const server=net.createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function waitForServer(child,url){const end=Date.now()+15000;while(Date.now()<end){if(child.exitCode!==null)throw new Error(`Server exit ${child.exitCode}`);try{if((await fetch(`${url}/api/health`)).ok)return}catch{}await new Promise(r=>setTimeout(r,100));}throw new Error('Server startup timeout');}
async function register(url,username){const r=await fetch(`${url}/api/auth/register`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username,password:'special-action-test-pass'})});const j=await r.json();assert.equal(r.status,201,JSON.stringify(j));return r.headers.get('set-cookie').split(';')[0];}
async function post(url,cookie,pathName,payload){const r=await fetch(`${url}${pathName}`,{method:'POST',headers:{Cookie:cookie,'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,payload:await r.json()};}

test('plane contributions, artifact recycling and direct messages are retry-safe',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'zombix-special-actions-'));
 const port=await unusedPort(),url=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,[path.join(ROOT,'server.js')],{cwd:ROOT,env:{...process.env,PORT:String(port),HOST:'127.0.0.1',NODE_ENV:'test',COOKIE_SECURE:'false',ZOMBIX_DATA_DIR:dataDir},stdio:['ignore','pipe','pipe']});
 let logs='';child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);
 t.after(async()=>{if(child.exitCode===null){child.kill('SIGTERM');await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>setTimeout(r,3000))]);if(child.exitCode===null)child.kill('SIGKILL');}fs.rmSync(dataDir,{recursive:true,force:true});});
 try{await waitForServer(child,url)}catch(e){throw new Error(`${e.message}\n${logs}`)}
 const senderCookie=await register(url,'ActionSender'),receiverCookie=await register(url,'ActionReceiver');
 const db=new DatabaseSync(path.join(dataDir,'game.sqlite'));
 const senderId=Number(db.prepare("SELECT id FROM players WHERE username='ActionSender'").get().id);
 const receiverId=Number(db.prepare("SELECT id FROM players WHERE username='ActionReceiver'").get().id);
 const original=JSON.parse(db.prepare('SELECT state_json FROM players WHERE id=?').get(senderId).state_json);
 original.coins=10000;original.gems=10;original.shards=0;original.artifacts=[{id:1,count:2}];
 db.prepare('UPDATE players SET state_json=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(original),senderId);
 syncPlayerProjection(db,senderId,original,{reason:'test_seed'});

 const recycleRequest={artifactId:1,quantity:1,idempotencyKey:'artifact_recycle_request_1'};
 const recycle=await post(url,senderCookie,'/api/artifacts/recycle',recycleRequest);
 assert.equal(recycle.status,200,JSON.stringify(recycle.payload));
 const recycleReplay=await post(url,senderCookie,'/api/artifacts/recycle',recycleRequest);
 assert.equal(recycleReplay.status,200);assert.equal(recycleReplay.payload.replayed,true);
 assert.equal(recycleReplay.payload.state.shards,recycle.payload.state.shards);
 assert.equal(recycleReplay.payload.state.artifacts.find(a=>a.id===1)?.count,1);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM wallet_ledger WHERE player_id=? AND reason='artifact_recycle'").get(senderId).n,1);

 const mailRequest={playerId:receiverId,message:'Привет, удачи в игре.',idempotencyKey:'mail_send_request_0001'};
 const sent=await post(url,senderCookie,'/api/mail/send',mailRequest);
 assert.equal(sent.status,200,JSON.stringify(sent.payload));
 const sentReplay=await post(url,senderCookie,'/api/mail/send',mailRequest);
 assert.equal(sentReplay.status,200);assert.equal(sentReplay.payload.replayed,true);
 assert.equal(sentReplay.payload.messageId,sent.payload.messageId);
 assert.equal(db.prepare("SELECT COUNT(*) n FROM player_mail WHERE kind='dm' AND sender_id=? AND player_id=?").get(senderId,receiverId).n,1);
 assert.equal(sentReplay.payload.state.gems,9);

 const planeRequest={coins:100,idempotencyKey:'plane_contribution_request_001'};
 const contributed=await post(url,senderCookie,'/api/plane/contribute',planeRequest);
 assert.equal(contributed.status,200,JSON.stringify(contributed.payload));
 const contributionReplay=await post(url,senderCookie,'/api/plane/contribute',planeRequest);
 assert.equal(contributionReplay.status,200);assert.equal(contributionReplay.payload.replayed,true);
 assert.equal(contributionReplay.payload.state.coins,contributed.payload.state.coins);
 assert.equal(db.prepare('SELECT coins FROM cargo_contributions WHERE flight_id=? AND player_id=?').get(contributed.payload.flightId,senderId).coins,100);
 assert.equal(contributionReplay.payload.state.coins,9900);

 const earlyClaim=await post(url,senderCookie,'/api/progression/claim',{achievementId:'first_case',idempotencyKey:'achievement_claim_early_001'});
 assert.equal(earlyClaim.status,400);
 const opened=await post(url,senderCookie,'/api/action',{action:'openCase',payload:{caseId:1,quantity:1},idempotencyKey:'first_achievement_case_01'});
 assert.equal(opened.status,200,JSON.stringify(opened.payload));
 const progressionResponse=await fetch(`${url}/api/progression`,{headers:{Cookie:senderCookie}});
 const progression=await progressionResponse.json();
 const firstAchievement=progression.achievements.find(a=>a.id==='first_case');
 assert.equal(firstAchievement.completed,true);
 assert.equal(firstAchievement.claimable,true);
 const beforeClaim=opened.payload.state.coins;
 const claimRequest={achievementId:'first_case',idempotencyKey:'achievement_claim_early_001'};
 const claim=await post(url,senderCookie,'/api/progression/claim',claimRequest);
 assert.equal(claim.status,200,JSON.stringify(claim.payload));
 assert.equal(claim.payload.reward.coins,150);
 assert.equal(claim.payload.state.coins,beforeClaim+150);
 const claimReplay=await post(url,senderCookie,'/api/progression/claim',claimRequest);
 assert.equal(claimReplay.status,200);assert.equal(claimReplay.payload.replayed,true);
 assert.equal(claimReplay.payload.state.coins,claim.payload.state.coins);
 const duplicateClaim=await post(url,senderCookie,'/api/progression/claim',{achievementId:'first_case',idempotencyKey:'achievement_claim_first_case_02'});
 assert.equal(duplicateClaim.status,400);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM player_achievement_claims WHERE player_id=? AND achievement_id=?').get(senderId,'first_case').n,1);

 const questInfo=await post(url,senderCookie,'/api/action',{action:'questInfo',payload:{}});
 assert.equal(questInfo.status,200,JSON.stringify(questInfo.payload));
 assert.equal(questInfo.payload.result.quests.daily.length,8);
 assert.equal(questInfo.payload.result.quests.weekly.length,6);
 const questStateRow=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(senderId);
 const questState=JSON.parse(questStateRow.state_json);
 const oldDailyIds=questState.dailyQuests.slice(0,7).map(q=>q.id);
 const oldWeeklyIds=questState.weeklyQuests.slice(0,5).map(q=>q.id);
 questState.dailyQuests=questState.dailyQuests.slice(0,7);
 questState.weeklyQuests=questState.weeklyQuests.slice(0,5);
 const preservedDaily=questState.dailyQuests[0];
 questState.dailyQuestProgress[preservedDaily.key]=2;
 db.prepare('UPDATE players SET state_json=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(questState),senderId);
 syncPlayerProjection(db,senderId,questState,{reason:'test_legacy_quest_seed'});
 const migrated=await post(url,senderCookie,'/api/action',{action:'questInfo',payload:{}});
 assert.equal(migrated.status,200,JSON.stringify(migrated.payload));
 assert.deepEqual(migrated.payload.result.quests.daily.slice(0,7).map(q=>q.id),oldDailyIds);
 assert.deepEqual(migrated.payload.result.quests.weekly.slice(0,5).map(q=>q.id),oldWeeklyIds);
 assert.equal(migrated.payload.result.dailyProgress[preservedDaily.key],2);
 const dailyQuest=migrated.payload.result.quests.daily[0];
 const weeklyQuest=migrated.payload.result.quests.weekly[0];
 assert.equal(migrated.payload.result.quests.daily.length,8);
 assert.equal(migrated.payload.result.quests.weekly.length,6);
 assert.ok(dailyQuest.reward.shards>=1&&dailyQuest.reward.shards<=50);
 assert.ok(weeklyQuest.reward.gems>=1&&weeklyQuest.reward.gems<=3);
 assert.ok(weeklyQuest.reward.shards>=25&&weeklyQuest.reward.shards<=100);
 const migratedStateRow=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(senderId);
 const questStateAfterMigration=JSON.parse(migratedStateRow.state_json);
 questStateAfterMigration.dailyQuestProgress[dailyQuest.key]=dailyQuest.target;
 questStateAfterMigration.weeklyQuestProgress[weeklyQuest.key]=weeklyQuest.target;
 db.prepare('UPDATE players SET state_json=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(questStateAfterMigration),senderId);
 syncPlayerProjection(db,senderId,questStateAfterMigration,{reason:'test_quest_progress'});
 const dailyBefore=questStateAfterMigration.shards;
 const dailyClaim=await post(url,senderCookie,'/api/action',{action:'claimQuest',payload:{period:'daily',id:dailyQuest.id},idempotencyKey:'daily_quest_claim_shards_001'});
 assert.equal(dailyClaim.status,200,JSON.stringify(dailyClaim.payload));
 assert.equal(dailyClaim.payload.state.shards,dailyBefore+dailyQuest.reward.shards);
 const weeklyBefore=dailyClaim.payload.state.shards;
 const weeklyClaim=await post(url,senderCookie,'/api/action',{action:'claimQuest',payload:{period:'weekly',id:weeklyQuest.id},idempotencyKey:'weekly_quest_claim_shards_001'});
 assert.equal(weeklyClaim.status,200,JSON.stringify(weeklyClaim.payload));
 assert.equal(weeklyClaim.payload.state.shards,weeklyBefore+weeklyQuest.reward.shards);
 assert.equal(weeklyClaim.payload.state.gems,dailyClaim.payload.state.gems+weeklyQuest.reward.gems);
 assert.equal(verifyPlayerProjections(db).ok,true,JSON.stringify(verifyPlayerProjections(db)));
 db.close();
});
