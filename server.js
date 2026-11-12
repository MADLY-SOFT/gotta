'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const zlib=require('node:zlib');
const {DatabaseSync}=require('node:sqlite');
const {getPromoExpiryError,getPromoRewardAmounts}=require('./lib/promo');
const {weightedPick,validateQuantity}=require('./lib/case-engine');
const {isAllowedMutationRequest}=require('./lib/request-security');
const {sanitizeInventory}=require('./lib/inventory');
const {ensurePlayerProjectionSchema,syncPlayerProjection,queryProjectedInventory,verifyPlayerProjections}=require('./lib/player-projection');
const {createAuthRateLimiter}=require('./lib/auth-rate-limit');
const {loadPromoCodes}=require('./lib/promo-store');
const {randomFloat,randomBetween}=require('./lib/secure-random');
const {rollQuestCurrencyRewards,repairQuestCurrencyRewards}=require('./lib/quest-rewards');
const {validateItemAtlas}=require('./lib/item-atlas');

const ROOT=__dirname, PUBLIC=path.join(ROOT,'public');
const PORT=Number(process.env.PORT||3000), HOST=process.env.HOST||'0.0.0.0';
const isProduction=process.env.NODE_ENV==='production';
const COOKIE_SECURE=process.env.COOKIE_SECURE==='true'||(isProduction&&process.env.COOKIE_SECURE!=='false');
const dbDir=path.resolve(process.env.ZOMBIX_DATA_DIR||path.join(ROOT,'server-data'));
fs.mkdirSync(dbDir,{recursive:true});
const mainDbPath=path.join(dbDir,'game.sqlite');
const mainDbExistedBeforeOpen=fs.existsSync(mainDbPath);
const db=new DatabaseSync(mainDbPath);
// Snapshot an existing player database before any schema writes for v86.
// VACUUM INTO reads a transactionally consistent image, including committed WAL data.
const hasPlayersTable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='players'").get());
const hasMigrationTable=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get());
const alreadyAtV86=hasMigrationTable&&Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get());
if(mainDbExistedBeforeOpen&&hasPlayersTable&&!alreadyAtV86&&Number(db.prepare('SELECT COUNT(*) c FROM players').get()?.c||0)>0){
  const backupDir=path.join(dbDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
  const backupPath=path.join(backupDir,`game-before-v86-migration-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
  const sqlPath=backupPath.replace(/'/g,"''");
  db.exec(`VACUUM INTO '${sqlPath}'`);
  console.log(`[DB] Pre-migration backup created: ${path.relative(ROOT,backupPath)}`);
}
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;
CREATE TABLE IF NOT EXISTS players(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL COLLATE NOCASE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,state_json TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,last_login_at INTEGER,state_version INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_player ON sessions(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS state_operations(op_id TEXT PRIMARY KEY,type TEXT NOT NULL,player_id INTEGER NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_state_operations_status ON state_operations(status,created_at);`);
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
ensurePlayerProjectionSchema(db);
// Idempotency for all non-case game actions, not just case openings.
db.exec(`CREATE TABLE IF NOT EXISTS player_action_requests(
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 request_id TEXT NOT NULL,
 action_type TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 result_json TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_player_action_requests_created ON player_action_requests(created_at);
CREATE TABLE IF NOT EXISTS player_achievement_claims(
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 achievement_id TEXT NOT NULL,
 reward_coins INTEGER NOT NULL DEFAULT 0,
 reward_gems INTEGER NOT NULL DEFAULT 0,
 reward_shards INTEGER NOT NULL DEFAULT 0,
 claimed_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_achievement_claims_player ON player_achievement_claims(player_id,claimed_at DESC);`);
// Session-aware presence and real activity aggregates.
db.exec(`CREATE TABLE IF NOT EXISTS player_presence(
 session_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 last_seen_at INTEGER NOT NULL,
 last_action_at INTEGER NOT NULL DEFAULT 0,
 client_kind TEXT NOT NULL DEFAULT 'web'
);
CREATE INDEX IF NOT EXISTS idx_presence_seen ON player_presence(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_presence_action ON player_presence(last_action_at);
CREATE TABLE IF NOT EXISTS player_activity_daily(
 player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 day_utc TEXT NOT NULL,
 action_count INTEGER NOT NULL DEFAULT 0,
 last_active_at INTEGER NOT NULL,
 PRIMARY KEY(player_id,day_utc)
);
CREATE INDEX IF NOT EXISTS idx_activity_day ON player_activity_daily(day_utc,last_active_at);
CREATE TABLE IF NOT EXISTS server_public_metrics(
 id INTEGER PRIMARY KEY CHECK(id=1),
 peak_online INTEGER NOT NULL DEFAULT 0,
 peak_at INTEGER,
 updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO server_public_metrics(id,peak_online,updated_at) VALUES(1,0,0);
`);
try{db.exec('ALTER TABLE players ADD COLUMN state_version INTEGER NOT NULL DEFAULT 0')}catch{}

// Versioned, non-destructive v86 migration.
db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
const V86_MIGRATION_VERSION=1;
const appliedV86Migration=db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(V86_MIGRATION_VERSION);
if(!appliedV86Migration){
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE IF NOT EXISTS case_openings(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      case_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 10),
      currency TEXT NOT NULL,
      total_cost INTEGER NOT NULL DEFAULT 0 CHECK(total_cost>=0),
      fast_fee_gems INTEGER NOT NULL DEFAULT 0 CHECK(fast_fee_gems>=0),
      total_vendor_value INTEGER NOT NULL DEFAULT 0 CHECK(total_vendor_value>=0),
      results_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(player_id,request_id)
    );
    CREATE INDEX IF NOT EXISTS idx_case_openings_player_page ON case_openings(player_id,id DESC);
    CREATE TABLE IF NOT EXISTS case_opening_drops(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opening_id INTEGER NOT NULL REFERENCES case_openings(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      item_id INTEGER NOT NULL,
      tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 6),
      vendor_value INTEGER NOT NULL DEFAULT 0 CHECK(vendor_value>=0)
    );
    CREATE INDEX IF NOT EXISTS idx_case_opening_drops_player_tier ON case_opening_drops(player_id,tier);
    CREATE INDEX IF NOT EXISTS idx_case_opening_drops_opening ON case_opening_drops(opening_id);
    CREATE TABLE IF NOT EXISTS player_case_stats(
      player_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      openings INTEGER NOT NULL DEFAULT 0,
      cases INTEGER NOT NULL DEFAULT 0,
      coin_spent INTEGER NOT NULL DEFAULT 0,
      gem_spent INTEGER NOT NULL DEFAULT 0,
      fast_gems INTEGER NOT NULL DEFAULT 0,
      total_vendor_value INTEGER NOT NULL DEFAULT 0,
      tier_1_count INTEGER NOT NULL DEFAULT 0,
      tier_2_count INTEGER NOT NULL DEFAULT 0,
      tier_3_count INTEGER NOT NULL DEFAULT 0,
      tier_4_count INTEGER NOT NULL DEFAULT 0,
      tier_5_count INTEGER NOT NULL DEFAULT 0,
      tier_6_count INTEGER NOT NULL DEFAULT 0,
      best_item_id INTEGER,
      best_tier INTEGER NOT NULL DEFAULT 0,
      best_vendor_value INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );`);
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(V86_MIGRATION_VERSION,Date.now());
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

// Mail is independent of player state. Rewards are held until claimed, or credited on expiry.
db.exec(`CREATE TABLE IF NOT EXISTS player_mail(
 id INTEGER PRIMARY KEY AUTOINCREMENT, player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
 operation_id TEXT UNIQUE, kind TEXT NOT NULL, artifact_id INTEGER, gross_gems INTEGER NOT NULL DEFAULT 0,
 fee_gems INTEGER NOT NULL DEFAULT 0, reward_gems INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, claimed_at INTEGER);
 CREATE INDEX IF NOT EXISTS idx_player_mail_owner ON player_mail(player_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS idx_player_mail_expiry ON player_mail(expires_at,claimed_at);`);
try{db.exec('ALTER TABLE player_mail ADD COLUMN reward_shards INTEGER NOT NULL DEFAULT 0')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN artifact_qty INTEGER NOT NULL DEFAULT 1')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN read_at INTEGER')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN archived_at INTEGER')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN sender_id INTEGER')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN sender_name TEXT')}catch{}
try{db.exec('ALTER TABLE player_mail ADD COLUMN message_text TEXT')}catch{}
db.exec('CREATE INDEX IF NOT EXISTS idx_mail_dm_sender ON player_mail(sender_id,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_mail_archive_player ON player_mail(player_id,archived_at,created_at)');
db.exec('CREATE INDEX IF NOT EXISTS idx_mail_unread ON player_mail(player_id,read_at,expires_at)');
const MAIL_LIFETIME=15*24*60*60*1000;
const MAX_ARTIFACT_STACK=1000000000; // 41 compact stacks, no overall inventory capacity.
db.exec(`CREATE INDEX IF NOT EXISTS idx_mail_pending_expiry ON player_mail(expires_at,id) WHERE claimed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_mail_visible_page ON player_mail(player_id,created_at DESC,id DESC) WHERE archived_at IS NULL;`);
let mailCleanupAt=0;
function settleExpiredMail(){
 const t=now();if(t<mailCleanupAt)return;mailCleanupAt=t+60000;
 const expired=db.prepare('SELECT * FROM player_mail WHERE expires_at<=? AND claimed_at IS NULL ORDER BY id LIMIT 300').all(t);
 for(const m of expired){
  db.exec('BEGIN IMMEDIATE');try{
   const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(m.player_id);
   if(row){const state=normalize(JSON.parse(row.state_json));if(m.kind==='plane_artifact'){if(!canAddArtifact(state,m.artifact_id,Number(m.artifact_qty||1))){db.prepare('UPDATE player_mail SET expires_at=? WHERE id=?').run(t+MAIL_LIFETIME,m.id);db.exec('COMMIT');continue;}addArtifact(state,m.artifact_id,Number(m.artifact_qty||1));}else {state.gems=Math.min(1000000000,state.gems+m.reward_gems);state.shards=Math.min(1000000000,state.shards+Number(m.reward_shards||0));}commitState(m.player_id,state,row.state_version,{reason:'mail_expiration',operationId:m.operation_id||null});}
   db.prepare('UPDATE player_mail SET claimed_at=?,read_at=COALESCE(read_at,?) WHERE id=? AND claimed_at IS NULL').run(t,t,m.id);
   db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');console.warn('[MAIL EXPIRY]',e.message);}
 }
 db.prepare('DELETE FROM player_mail WHERE id IN (SELECT id FROM player_mail WHERE expires_at<=? AND claimed_at IS NOT NULL LIMIT 2000)').run(t);
 // Keep database maintenance bounded; pending rewards are never purged.
 db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(t);
 db.prepare("DELETE FROM state_operations WHERE op_id IN (SELECT op_id FROM state_operations WHERE status NOT IN ('pending','processing') AND updated_at<? LIMIT 500)").run(t-30*86400000);
 // Remove only aged, delivered and already-claimed cargo. Pending mail remains linked until settled.
 db.prepare(`DELETE FROM cargo_rewards WHERE rowid IN (SELECT c.rowid FROM cargo_rewards c JOIN cargo_flights f ON f.id=c.flight_id LEFT JOIN player_mail m ON m.id=c.mail_id WHERE f.drop_until<? AND c.mail_id IS NOT NULL AND (m.id IS NULL OR (m.claimed_at IS NOT NULL AND m.expires_at<=?)) LIMIT 1000)`).run(t-45*86400000,t);
 db.prepare(`DELETE FROM cargo_contributions WHERE flight_id IN (SELECT f.id FROM cargo_flights f WHERE f.drop_until<? AND NOT EXISTS(SELECT 1 FROM cargo_rewards c WHERE c.flight_id=f.id) AND f.id<>(SELECT MAX(id) FROM cargo_flights) LIMIT 100)`).run(t-45*86400000);
 db.prepare(`DELETE FROM cargo_flights WHERE id IN (SELECT f.id FROM cargo_flights f WHERE f.drop_until<? AND f.id<>(SELECT MAX(id) FROM cargo_flights) AND NOT EXISTS(SELECT 1 FROM cargo_contributions c WHERE c.flight_id=f.id) AND NOT EXISTS(SELECT 1 FROM cargo_rewards r WHERE r.flight_id=f.id) LIMIT 100)`).run(t-45*86400000);
}

// Shared cargo flight. Epoch schedule persists; processing is lazy, bounded and idempotent.
const PLANE_PREP=60000,PLANE_FLIGHT=30000,PLANE_DROP=30000,PLANE_SLOT=1000; // TEST durations: production 3h / 30m / 30m
db.exec(`CREATE TABLE IF NOT EXISTS cargo_flights(id INTEGER PRIMARY KEY AUTOINCREMENT,prep_until INTEGER NOT NULL,flight_until INTEGER NOT NULL,drop_until INTEGER NOT NULL,settled_at INTEGER);
CREATE TABLE IF NOT EXISTS cargo_contributions(flight_id INTEGER NOT NULL,player_id INTEGER NOT NULL,coins INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(flight_id,player_id));
CREATE TABLE IF NOT EXISTS cargo_rewards(flight_id INTEGER NOT NULL,player_id INTEGER NOT NULL,artifact_id INTEGER,delivery_at INTEGER NOT NULL,mail_id INTEGER,PRIMARY KEY(flight_id,player_id,artifact_id,delivery_at));
CREATE INDEX IF NOT EXISTS idx_cargo_reward_due ON cargo_rewards(delivery_at,mail_id); CREATE INDEX IF NOT EXISTS idx_cargo_pending ON cargo_rewards(delivery_at) WHERE mail_id IS NULL;`);
try{db.exec('ALTER TABLE cargo_rewards ADD COLUMN reward_shards INTEGER NOT NULL DEFAULT 0')}catch{}
try{db.exec('ALTER TABLE cargo_rewards ADD COLUMN artifact_qty INTEGER NOT NULL DEFAULT 1')}catch{}
// Upgrade older cargo databases without discarding pending deliveries. SQLite cannot DROP NOT NULL directly.
if(db.prepare("PRAGMA table_info(cargo_rewards)").all().some(c=>c.name==='artifact_id'&&c.notnull)){
 db.exec(`BEGIN IMMEDIATE;
 CREATE TABLE cargo_rewards_new(flight_id INTEGER NOT NULL,player_id INTEGER NOT NULL,artifact_id INTEGER,delivery_at INTEGER NOT NULL,mail_id INTEGER,reward_shards INTEGER NOT NULL DEFAULT 0,artifact_qty INTEGER NOT NULL DEFAULT 1,PRIMARY KEY(flight_id,player_id,artifact_id,delivery_at));
 INSERT INTO cargo_rewards_new(rowid,flight_id,player_id,artifact_id,delivery_at,mail_id,reward_shards,artifact_qty) SELECT rowid,flight_id,player_id,artifact_id,delivery_at,mail_id,COALESCE(reward_shards,0),COALESCE(artifact_qty,1) FROM cargo_rewards;
 DROP TABLE cargo_rewards; ALTER TABLE cargo_rewards_new RENAME TO cargo_rewards;
 CREATE INDEX idx_cargo_reward_due ON cargo_rewards(delivery_at,mail_id);
 CREATE INDEX idx_cargo_pending ON cargo_rewards(delivery_at) WHERE mail_id IS NULL; COMMIT;`);
}
function currentFlight(){let r=db.prepare('SELECT * FROM cargo_flights ORDER BY id DESC LIMIT 1').get();if(!r){const t=now();db.prepare('INSERT INTO cargo_flights(prep_until,flight_until,drop_until) VALUES(?,?,?)').run(t+PLANE_PREP,t+PLANE_PREP+PLANE_FLIGHT,t+PLANE_PREP+PLANE_FLIGHT+PLANE_DROP);r=db.prepare('SELECT * FROM cargo_flights ORDER BY id DESC LIMIT 1').get();}return r;}
function planePhase(r,t=now()){return t<r.prep_until?'prep':t<r.flight_until?'flight':t<r.drop_until?'drop':'done';}
function planeWeight(coins){return coins>0?Math.sqrt(coins/PLANE_SLOT):0;} // Partial contributions have a real chance; diminishing returns for large contributors.
function artifactRecycleValue(aid){return [15,20,25,30][Math.min(3,Math.floor((Number(aid)-1)/11))]||15;}
function planeSettle(r){if(r.settled_at||now()<r.flight_until)return;db.exec('BEGIN IMMEDIATE');try{
 const ok=db.prepare('UPDATE cargo_flights SET settled_at=? WHERE id=? AND settled_at IS NULL').run(now(),r.id);if(!ok.changes){db.exec('COMMIT');return;}
 const people=db.prepare('SELECT player_id,coins FROM cargo_contributions WHERE flight_id=? AND coins>0 ORDER BY player_id').all(r.id).map(x=>({...x,weight:planeWeight(x.coins)}));
 const budget=people.reduce((v,x)=>v+x.coins,0),total=people.reduce((v,x)=>v+x.weight,0);
 // A cargo place represents ONE artifact physically aboard, not one ticket for a particular person.
 // Every coin participates in weighted allocation, including contributions below 10,000.
 const guaranteed=Math.floor(budget/PLANE_SLOT);const rng=()=>crypto.randomInt(0,0x100000000)/4294967296;
 // Small underfunded flights may still find an artifact, otherwise occasionally return a few shards.
 const lucky=guaranteed===0&&budget>0&&rng()<Math.min(.12,.12*budget/PLANE_SLOT)?1:0;
 const count=guaranteed+lucky; // all guaranteed cargo preserved, settlement uses grouped rewards below
 const add=db.prepare('INSERT INTO cargo_rewards(flight_id,player_id,artifact_id,delivery_at,artifact_qty) VALUES(?,?,?,?,?)');
 const grouped=new Map();
 const addShards=db.prepare('INSERT INTO cargo_rewards(flight_id,player_id,artifact_id,delivery_at,reward_shards) VALUES(?,?,?,?,?)');
 function pick(){let draw=rng()*total;for(const x of people){draw-=x.weight;if(draw<0)return x;}return people[people.length-1];}
 const winnerIds=new Set(),awarded=new Map();
 function balancedPick(){let remaining=0;for(const x of people)remaining+=x.weight/Math.sqrt(1+(awarded.get(x.player_id)||0)*0.32);let draw=rng()*remaining;for(const x of people){draw-=x.weight/Math.sqrt(1+(awarded.get(x.player_id)||0)*0.32);if(draw<0)return x;}return people[people.length-1];}
 for(let i=0;i<count;i++){
  const chosen=balancedPick();awarded.set(chosen.player_id,(awarded.get(chosen.player_id)||0)+1);winnerIds.add(chosen.player_id);const ids=ARTIFACTS_DATA.artifacts;const rarity=rng();const pool=ids.filter(a=>{const tier=Math.min(3,Math.floor((Number(a.id)-1)/11));return rarity<.72?tier===0:rarity<.93?tier===1:rarity<.99?tier===2:tier===3;});const list=pool.length?pool:ids;const artifact=list[Math.floor(rng()*list.length)];
  const aid=Number(artifact.id),key=chosen.player_id+':'+aid;grouped.set(key,{player_id:chosen.player_id,artifact_id:aid,qty:(grouped.get(key)?.qty||0)+1});
 }
 // One row per player/artifact per flight instead of one row per individual copy.
 for(const entry of grouped.values())add.run(r.id,entry.player_id,entry.artifact_id,r.flight_until+Math.floor(rng()*PLANE_DROP),entry.qty);
 // A rare consolation for participants who received no artifact. Never guarantees shards or compensates full cost.
 if(count>0){for(const person of people){if(!winnerIds.has(person.player_id)&&rng()<.08){addShards.run(r.id,person.player_id,null,r.flight_until+Math.floor(rng()*PLANE_DROP),5+crypto.randomInt(11));}}}
 if(guaranteed===0&&lucky===0&&people.length&&rng()<.18){const chosen=pick();addShards.run(r.id,chosen.player_id,null,r.flight_until+Math.floor(rng()*PLANE_DROP),5+crypto.randomInt(16));}
 // A flight with no rewards still produces one readable result letter for every participant.
 for(const person of people){const has=db.prepare('SELECT 1 FROM cargo_rewards WHERE flight_id=? AND player_id=? LIMIT 1').get(r.id,person.player_id);if(!has)addShards.run(r.id,person.player_id,null,r.flight_until+Math.floor(rng()*PLANE_DROP),0);}
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}}
function planeTick(){let r=currentFlight();if(now()>=r.flight_until&&!r.settled_at){planeSettle(r);r=currentFlight();}
 // Insert due mail in bounded batch; uniqueness is enforced by cargo_rewards.mail_id and operation_id.
 const due=db.prepare('SELECT rowid,* FROM cargo_rewards WHERE mail_id IS NULL AND delivery_at<=? ORDER BY delivery_at LIMIT 200').all(now());
 if(due.length){db.exec('BEGIN IMMEDIATE');try{for(const reward of due){const op=`cargo:${reward.rowid}`;const ins=db.prepare(`INSERT OR IGNORE INTO player_mail(player_id,operation_id,kind,artifact_id,reward_shards,created_at,expires_at,artifact_qty) VALUES(?,?,?,?,?,?,?,?)`).run(reward.player_id,op,reward.artifact_id==null?(reward.reward_shards?'plane_shards':'plane_summary'):'plane_artifact',reward.artifact_id,reward.reward_shards||0,reward.delivery_at,reward.delivery_at+MAIL_LIFETIME,reward.artifact_qty||1);const mid=Number(ins.lastInsertRowid)||Number(db.prepare('SELECT id FROM player_mail WHERE operation_id=?').get(op)?.id);db.prepare('UPDATE cargo_rewards SET mail_id=? WHERE rowid=? AND mail_id IS NULL').run(mid,reward.rowid);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}
 if(now()>=r.drop_until){const next=db.prepare('SELECT id FROM cargo_flights WHERE id>? LIMIT 1').get(r.id);if(!next){const start=Math.max(r.drop_until,now());db.prepare('INSERT INTO cargo_flights(prep_until,flight_until,drop_until) VALUES(?,?,?)').run(start+PLANE_PREP,start+PLANE_PREP+PLANE_FLIGHT,start+PLANE_PREP+PLANE_FLIGHT+PLANE_DROP);}r=currentFlight();}return r;
}

// Existing IDs are never rewritten. Reserve 1–999 for legacy accounts; new installs start at 1000.
const playerSequence=db.prepare("SELECT seq FROM sqlite_sequence WHERE name='players'").get();
if(!playerSequence)db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES('players',999)").run();
else if(Number(playerSequence.seq)<999)db.prepare("UPDATE sqlite_sequence SET seq=999 WHERE name='players'").run();


// Market data is migrated into the primary database so wallet, inventory and
// listing mutations share one SQLite transaction boundary.
const marketPath=path.join(dbDir,'market.sqlite');
const marketExists=fs.existsSync(marketPath);
const marketMigrationDone=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get());
if(marketExists&&!marketMigrationDone&&alreadyAtV86){
 const backupDir=path.join(dbDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
 const backupPath=path.join(backupDir,`market-before-v89-merge-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
 const legacyBackup=new DatabaseSync(marketPath);
 try{legacyBackup.exec(`VACUUM INTO '${backupPath.replace(/'/g,"''")}'`);}
 finally{legacyBackup.close();}
 console.log(`[DB] Pre-v89 market backup created: ${path.relative(ROOT,backupPath)}`);
}
if(!marketMigrationDone&&alreadyAtV86&&mainDbExistedBeforeOpen&&hasPlayersTable&&Number(db.prepare('SELECT COUNT(*) c FROM players').get()?.c||0)>0){
 const backupDir=path.join(dbDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
 const backupPath=path.join(backupDir,`game-before-v89-market-merge-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`);
 db.exec(`VACUUM INTO '${backupPath.replace(/'/g,"''")}'`);
 console.log(`[DB] Pre-v89 market merge backup created: ${path.relative(ROOT,backupPath)}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,seller_id INTEGER NOT NULL,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',buyer_id INTEGER,sold_at INTEGER,cancelled_at INTEGER,operation_id TEXT,currency TEXT NOT NULL DEFAULT 'gems');
CREATE TABLE IF NOT EXISTS market_history(id INTEGER PRIMARY KEY AUTOINCREMENT,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,quantity INTEGER NOT NULL,kind TEXT NOT NULL,recorded_at INTEGER NOT NULL,operation_id TEXT);
CREATE TABLE IF NOT EXISTS market_stats(artifact_id INTEGER PRIMARY KEY,sales INTEGER NOT NULL DEFAULT 0,total_price INTEGER NOT NULL DEFAULT 0,min_price INTEGER,max_price INTEGER);
CREATE TABLE IF NOT EXISTS market_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
if(marketExists){
  const escaped=marketPath.replace(/'/g,"''");
  db.exec(`ATTACH DATABASE '${escaped}' AS legacy_market`);
  try{
    db.exec('BEGIN IMMEDIATE');
    for(const [table,ddl] of [
      ['orders',`CREATE TABLE IF NOT EXISTS orders(id INTEGER PRIMARY KEY AUTOINCREMENT,seller_id INTEGER NOT NULL,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,created_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',buyer_id INTEGER,sold_at INTEGER,cancelled_at INTEGER,operation_id TEXT,currency TEXT NOT NULL DEFAULT 'gems')`],
      ['market_history',`CREATE TABLE IF NOT EXISTS market_history(id INTEGER PRIMARY KEY AUTOINCREMENT,artifact_id INTEGER NOT NULL,price_gems INTEGER NOT NULL,quantity INTEGER NOT NULL,kind TEXT NOT NULL,recorded_at INTEGER NOT NULL,operation_id TEXT)`],
      ['market_stats',`CREATE TABLE IF NOT EXISTS market_stats(artifact_id INTEGER PRIMARY KEY,sales INTEGER NOT NULL DEFAULT 0,total_price INTEGER NOT NULL DEFAULT 0,min_price INTEGER,max_price INTEGER)`],
      ['market_meta',`CREATE TABLE IF NOT EXISTS market_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)`]
    ]) db.exec(ddl);
    const legacyTables=new Set(db.prepare("SELECT name FROM legacy_market.sqlite_master WHERE type='table'").all().map(x=>x.name));
    if(legacyTables.has('orders')){
      const cols=new Set(db.prepare('PRAGMA legacy_market.table_info(orders)').all().map(x=>x.name));
      const op=cols.has('operation_id')?'operation_id':'NULL';
      const currency=cols.has('currency')?'currency':"'gems'";
      db.exec(`INSERT OR IGNORE INTO main.orders(id,seller_id,artifact_id,price_gems,created_at,status,buyer_id,sold_at,cancelled_at,operation_id,currency)
        SELECT id,seller_id,artifact_id,price_gems,created_at,status,buyer_id,sold_at,cancelled_at,${op},${currency} FROM legacy_market.orders`);
    }
    if(legacyTables.has('market_history')){
      const cols=new Set(db.prepare('PRAGMA legacy_market.table_info(market_history)').all().map(x=>x.name));
      const op=cols.has('operation_id')?'operation_id':'NULL';
      db.exec(`INSERT OR IGNORE INTO main.market_history(id,artifact_id,price_gems,quantity,kind,recorded_at,operation_id)
        SELECT id,artifact_id,price_gems,quantity,kind,recorded_at,${op} FROM legacy_market.market_history`);
    }
    if(legacyTables.has('market_stats')) db.exec(`INSERT OR IGNORE INTO main.market_stats SELECT * FROM legacy_market.market_stats`);
    if(legacyTables.has('market_meta')) db.exec(`INSERT OR IGNORE INTO main.market_meta SELECT * FROM legacy_market.market_meta`);
    db.exec('COMMIT');
  } catch(e) {
    try{db.exec('ROLLBACK')}catch{}
    throw e;
  } finally { db.exec('DETACH DATABASE legacy_market'); }
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_cheapest ON orders(artifact_id,status,price_gems,created_at,id);
CREATE INDEX IF NOT EXISTS idx_orders_seller ON orders(seller_id,status);
CREATE INDEX IF NOT EXISTS idx_orders_operation_id ON orders(operation_id) WHERE operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_market_history_artifact_time ON market_history(artifact_id,recorded_at);
CREATE INDEX IF NOT EXISTS idx_market_history_sales_page ON market_history(artifact_id,kind,recorded_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS idx_orders_active_price ON orders(artifact_id,price_gems,created_at,id) WHERE status='active';
CREATE INDEX IF NOT EXISTS idx_orders_seller_active ON orders(seller_id,artifact_id) WHERE status='active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_history_operation_id ON market_history(operation_id) WHERE operation_id IS NOT NULL;
INSERT OR IGNORE INTO market_stats(artifact_id,sales,total_price,min_price,max_price)
 SELECT artifact_id,COUNT(*),SUM(price_gems),MIN(price_gems),MAX(price_gems) FROM orders WHERE status='sold' AND currency='shards' GROUP BY artifact_id;
CREATE TRIGGER IF NOT EXISTS trg_market_sale_stats AFTER UPDATE OF status ON orders WHEN NEW.status='sold' AND OLD.status<>'sold' AND NEW.currency='shards' BEGIN
 INSERT INTO market_stats(artifact_id,sales,total_price,min_price,max_price) VALUES(NEW.artifact_id,1,NEW.price_gems,NEW.price_gems,NEW.price_gems)
 ON CONFLICT(artifact_id) DO UPDATE SET sales=sales+1,total_price=total_price+excluded.total_price,min_price=MIN(min_price,excluded.min_price),max_price=MAX(max_price,excluded.max_price);
END;`);
try{
 const hasOld=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='market_listings'").get());
 if(hasOld){
  db.exec(`INSERT OR IGNORE INTO orders(id,seller_id,artifact_id,price_gems,created_at,status,buyer_id,sold_at,cancelled_at,currency)
   SELECT id,seller_id,artifact_id,price_gems,created_at,status,buyer_id,sold_at,cancelled_at,'gems' FROM market_listings`);
 }
}catch(e){console.warn('[MARKET MIGRATION]',e.message)}
if(!marketMigrationDone)db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,?)').run(now());
db.prepare('INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,?)').run(now());
const marketDb=db;
let marketActionQueue=Promise.resolve();
async function withMarketActionLock(fn){
  const previous=marketActionQueue;
  let release;
  marketActionQueue=new Promise(resolve=>{release=resolve;});
  await previous;
  try{return await fn();}
  finally{release();}
}
let marketCleanupAt=0;
const playerActionLocks=new Map();
async function withPlayerActionLock(playerId,fn){
  const id=Number(playerId)||0,previous=playerActionLocks.get(id)||Promise.resolve();
  let release; const current=new Promise(resolve=>{release=resolve;});
  playerActionLocks.set(id,current);
  await previous;
  try{return await fn();}
  finally{release();if(playerActionLocks.get(id)===current)playerActionLocks.delete(id);}
}


function readJson(name){return JSON.parse(fs.readFileSync(path.join(PUBLIC,'data',name),'utf8'));}
const ITEMS=readJson('items.json');
const CASES=readJson('cases.json');
const AVATARS=readJson('avatars.json');
const HOUSE=readJson('house.json');
const DAILY_REWARDS_DATA=readJson('daily_rewards.json');
const ARTIFACTS_DATA=readJson('artifacts.json');
const PROMO_CODES_DATA=loadPromoCodes({root:ROOT,publicDir:PUBLIC,filePath:process.env.ZOMBIX_PROMO_FILE}).data;
const itemById=new Map((ITEMS.items||[]).map(x=>[Number(x.id),x]));
const caseById=new Map((CASES.cases||[]).map(x=>[Number(x.id),x]));
const avatarById=new Map((AVATARS.avatars||[]).map(x=>[Number(x.id),x]));
const houseByLevel=new Map((HOUSE.levels||[]).map(x=>[Number(x.level),x]));
const bgById=new Map((HOUSE.backgrounds||[]).map(x=>[String(x.id),x]));
const promoByCode=new Map((PROMO_CODES_DATA.codes||[]).map(x=>[String(x.code||'').trim().toUpperCase(),x]));
const artifactById=new Map((ARTIFACTS_DATA.artifacts||[]).map(x=>[Number(x.id),x]));

function validateStaticData(){
  const items=ITEMS.items||[], cases=CASES.cases||[];
  if(!cases.length) throw new Error('Пустая база кейсов.');
  if(!Array.isArray(ARTIFACTS_DATA.artifacts)||ARTIFACTS_DATA.artifacts.length<1) throw new Error('Пустая база артефактов.');
  for(const a of ARTIFACTS_DATA.artifacts){if(!Number.isInteger(Number(a.id))||!a.name||!a.image)throw new Error('Некорректный артефакт.');if(!fs.existsSync(path.join(PUBLIC,String(a.image))))throw new Error(`Нет изображения артефакта: ${a.image}`);}
  if(!items.length) throw new Error('Пустая база предметов.');
  const comboSeen=new Set();
  for(const it of items){
    for(let tier=1;tier<=6;tier++){
      const p=Number(it?.tiers?.[String(tier)]?.price||0);
      if(!Number.isFinite(p)||p<=0) throw new Error(`Некорректная цена предмета ${it.id} T${tier}`);
      if(tier>1 && p<=Number(it.tiers[String(tier-1)].price)) throw new Error(`Цена предмета ${it.id} не растёт по тиру`);
    }
    // item.image is a stable legacy identifier (png/items/items_N.png), not a
    // physical per-item file. Rendering and validation use the shared atlas.
  }
  validateItemAtlas(ROOT,items);
  const paid=cases.filter(c=>!c.isAd).sort((a,b)=>Number(a.requiredLevel)-Number(b.requiredLevel));
  for(let i=1;i<paid.length;i++) if(Number(paid[i].requiredLevel)<=Number(paid[i-1].requiredLevel)) throw new Error('Уровни кейсов должны строго возрастать.');
  for(const c of cases){
    const rows=Array.isArray(c.dropTable)?c.dropTable:[];
    if(!rows.length) throw new Error(`Пустой кейс ${c.id}`);
    const sum=rows.reduce((a,d)=>a+Number(d.chance||0),0);
    if(Math.abs(sum-100)>0.02) throw new Error(`Сумма шансов кейса ${c.id} не равна 100%.`);
    const local=new Set();
    for(const d of rows){
      const itemId=Number(d.itemId),tier=Number(d.tier),chance=Number(d.chance);
      const key=`${itemId}:${tier}`;
      if(local.has(key)) throw new Error(`Дубликат ${key} в кейсе ${c.id}`);
      local.add(key);
      if(!Number.isInteger(itemId)||!itemById.has(itemId)||!Number.isInteger(tier)||!itemById.get(itemId)?.tiers?.[String(tier)]) throw new Error(`Некорректный дроп в кейсе ${c.id}`);
      if(!Number.isFinite(chance)||chance<0) throw new Error(`Некорректный шанс ${d.chance} в кейсе ${c.id}`);
      comboSeen.add(key);
    }
  }
  const requiredCombos=items.length*6;
  if(comboSeen.size<requiredCombos) throw new Error(`Покрытие предметов/тиров неполное: ${comboSeen.size}/${requiredCombos}`);
  if((DAILY_REWARDS_DATA.rewards||[]).length<30) throw new Error('В базе ежедневных наград меньше 30 дней.');
  if((HOUSE.levels||[]).length!==30) throw new Error('В базе дома должно быть 30 уровней.');
}
validateStaticData();

const DEFAULT={coins:1000,gems:10,level:1,experience:0,expToNext:75,totalCasesOpened:0,totalCoinsEarned:0,nickname:'',nicknameChangeCount:0,promoUsed:[],inventory:[],ownedAvatars:[1],selectedAvatar:1,lastAvatarChangeTime:0,houseLevel:1,lastHouseCollectTime:Date.now(),houseIncomeEarned:0,ownedHouseBackgrounds:['day'],selectedHouseBackground:'day',rating:0,dailyQuestKey:'',dailyQuestProgress:{cases:0,coins:0,sell:0,contracts:0,house:0,rare:0,levels:0,houseCollect:0,spend:0,gems:0,xp:0},dailyQuestClaimed:[],dailyQuests:[],weeklyQuestKey:'',weeklyQuestProgress:{cases:0,coins:0,sell:0,contracts:0,house:0,rare:0,levels:0,houseCollect:0,spend:0,gems:0,xp:0},weeklyQuestClaimed:[],weeklyQuests:[],_dailySeed:0,_weeklySeed:0,settings:{sound:true,skin:'gold',corners:'rounded',allowMessages:true},lastAdCoinsTime:0,adCoinsDayKey:'',adCoinsDailyCount:0,lastAdCaseTime:0,dailyRewardDay:1,dailyRewardLastClaim:'',houseCycle:1,artifacts:[],collectionFound:[],shards:0};
const DAILY_CYCLE_DAYS=Math.max(1,Math.min(30,Number(DAILY_REWARDS_DATA.cycleDays)||30));
const DAILY_REWARDS=(DAILY_REWARDS_DATA.rewards||[]).filter(r=>Number(r.day)>=1&&Number(r.day)<=DAILY_CYCLE_DAYS).sort((a,b)=>Number(a.day)-Number(b.day)).slice(0,DAILY_CYCLE_DAYS).map(r=>({day:Number(r.day),coins:Math.max(0,Math.floor(Number(r.coins)||0)),gems:Math.max(0,Math.floor(Number(r.gems)||0)),items:Array.isArray(r.items)?r.items.slice(0,20).map(x=>({itemId:Math.floor(Number(x?.itemId)),tier:Math.max(1,Math.min(6,Math.floor(Number(x?.tier)||1))),count:Math.max(1,Math.min(100,Math.floor(Number(x?.count)||1)))})).filter(x=>itemById.has(x.itemId)&&itemById.get(x.itemId)?.tiers?.[String(x.tier)]):[]}));

const MAX_LEVEL=Math.max(1,Math.min(1000,Number(HOUSE.maxPlayerLevel||100)));
// Large enough for long-term collectors; normalization never silently truncates saved items.
const MAX_INVENTORY=100000;
const AD_CASE_COOLDOWN_MS=Number((CASES.cases||[]).find(c=>c.isAd)?.adCooldown||60000);
const AD_COINS_COOLDOWN_MS=60000;
const AD_COINS_REWARD=150;
const AD_COINS_DAILY_CAP=20;
const GEM_COIN_VALUE=15000;
const MAX_HOUSE_COLLECT_MINUTES=Number(HOUSE.maxCollectHours||4)*60;
const skins=new Set(['gold','ice','fire','toxic','violet','ocean','sand','neon','cyber']),corners=new Set(['rounded','square']);

function clone(x){return JSON.parse(JSON.stringify(x));}
function tokenHash(x){return crypto.createHash('sha256').update(x).digest('hex');}
function passHash(p,s){return crypto.scryptSync(p,s,64).toString('hex');}
function verify(p,s,h){const a=Buffer.from(passHash(p,s),'hex'),b=Buffer.from(h,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}
function now(){return Date.now();}
function randomInt(min,max){const lo=Math.ceil(Number(min)),hi=Math.floor(Number(max));if(!Number.isSafeInteger(lo)||!Number.isSafeInteger(hi)||hi<lo)throw new Error('Invalid random integer range.');return crypto.randomInt(lo,hi+1);}
function calculateExpToNext(level){return Math.max(75,Math.floor(level*75));}
function levelUp(state, amount){
  let xp=Math.max(0,Math.floor(Number(amount)||0)), coinReward=0, gemReward=0, levels=0;
  state.experience += xp;
  while(state.level<MAX_LEVEL && state.experience>=calculateExpToNext(state.level)){
    state.experience-=calculateExpToNext(state.level); state.level++; levels++;
    coinReward += state.level*100; gemReward += state.level;
  }
  if(state.level>=MAX_LEVEL) state.experience=Math.min(state.experience,calculateExpToNext(MAX_LEVEL)-1);
  state.expToNext=calculateExpToNext(state.level);
  if(levels)bumpQuest(state,'levels',levels,now());
  if(coinReward)addCoins(state,coinReward);
  state.gems+=gemReward; if(gemReward)bumpQuest(state,'gems',gemReward,now());
  return {xp,levels,coinReward,gemReward};
}
function sanitizePlayerInventory(list){return sanitizeInventory(list,itemById,MAX_INVENTORY);}
function clientItem(id,tier){const item=itemById.get(Number(id));if(!item||!item.tiers?.[String(tier)])return null;return {id:item.id,name:item.name,image:item.image,tier:Number(tier)};}
function normalize(raw){
  const s=clone(DEFAULT); if(!raw||typeof raw!=='object') return s;
  s.nickname=String(raw.nickname||'').trim().slice(0,24);
  s.nicknameChangeCount=Math.max(0,Math.min(100,Math.floor(Number(raw.nicknameChangeCount)||0)));
  s.promoUsed=Array.isArray(raw.promoUsed)?[...new Set(raw.promoUsed.map(x=>String(x).trim().toUpperCase()).filter(Boolean))].slice(0,500):[];
  const intFields=['coins','gems','shards','level','experience','totalCasesOpened','totalCoinsEarned','houseLevel','lastHouseCollectTime','houseIncomeEarned','lastAdCoinsTime','adCoinsDailyCount','lastAdCaseTime','dailyRewardDay','houseCycle','rating'];
  for(const k of intFields) if(Number.isFinite(raw[k])) s[k]=Math.max(0,Math.floor(raw[k]));
  s.level=Math.min(MAX_LEVEL,Math.max(1,s.level));
  s.houseLevel=Math.min(30,Math.max(1,s.houseLevel));
  s.experience=Math.min(1000000000,s.experience); s.expToNext=calculateExpToNext(s.level);
  s.coins=Math.min(100000000000,s.coins); s.gems=Math.min(1000000000,s.gems); s.shards=Math.min(1000000000,s.shards);
  s.totalCasesOpened=Math.min(1000000000,s.totalCasesOpened); s.totalCoinsEarned=Math.min(100000000000,s.totalCoinsEarned); s.houseIncomeEarned=Math.min(100000000000,s.houseIncomeEarned); s.rating=Math.min(1000000000,s.rating); 
  s.dailyQuestKey=typeof raw.dailyQuestKey==='string'?raw.dailyQuestKey:''; s.dailyQuestProgress={...DEFAULT.dailyQuestProgress,...(raw.dailyQuestProgress||{})}; for(const k of Object.keys(DEFAULT.dailyQuestProgress)) s.dailyQuestProgress[k]=Math.min(100000000,Math.max(0,Math.floor(Number(s.dailyQuestProgress[k])||0))); s.dailyQuestClaimed=Array.isArray(raw.dailyQuestClaimed)?raw.dailyQuestClaimed.map(String).filter(Boolean):[]; s.dailyQuests=Array.isArray(raw.dailyQuests)?raw.dailyQuests.slice(0,8).map(q=>({id:String(q?.id||''),key:String(q?.key||''),target:Math.max(1,Math.floor(Number(q?.target)||1)),rating:Math.max(0,Math.floor(Number(q?.rating)||0)),reward:q?.reward&&typeof q.reward==='object'?{coins:Math.max(0,Math.floor(Number(q.reward.coins)||0)),gems:Math.max(0,Math.floor(Number(q.reward.gems)||0)),shards:Math.max(0,Math.floor(Number(q.reward.shards)||0))}: {}})).filter(q=>q.id&&q.key!=='survivor'&&q.key):[];
  s.weeklyQuestKey=typeof raw.weeklyQuestKey==='string'?raw.weeklyQuestKey:''; s.weeklyQuestProgress={...DEFAULT.weeklyQuestProgress,...(raw.weeklyQuestProgress||{})}; for(const k of Object.keys(DEFAULT.weeklyQuestProgress)) s.weeklyQuestProgress[k]=Math.min(100000000,Math.max(0,Math.floor(Number(s.weeklyQuestProgress[k])||0))); s.weeklyQuestClaimed=Array.isArray(raw.weeklyQuestClaimed)?raw.weeklyQuestClaimed.map(String).filter(Boolean):[]; s.weeklyQuests=Array.isArray(raw.weeklyQuests)?raw.weeklyQuests.slice(0,8).map(q=>({id:String(q?.id||''),key:String(q?.key||''),target:Math.max(1,Math.floor(Number(q?.target)||1)),rating:Math.max(0,Math.floor(Number(q?.rating)||0)),reward:q?.reward&&typeof q.reward==='object'?{coins:Math.max(0,Math.floor(Number(q.reward.coins)||0)),gems:Math.max(0,Math.floor(Number(q.reward.gems)||0)),shards:Math.max(0,Math.floor(Number(q.reward.shards)||0))}: {}})).filter(q=>q.id&&q.key!=='survivor'&&q.key):[];
  s._dailySeed=Math.max(0,Math.floor(Number(raw._dailySeed)||0)); s._weeklySeed=Math.max(0,Math.floor(Number(raw._weeklySeed)||0));
  s.inventory=sanitizePlayerInventory(raw.inventory);
  s.artifacts=Array.isArray(raw.artifacts)?raw.artifacts.map(x=>({id:Math.floor(Number(x?.id)),count:Math.max(1,Math.min(MAX_ARTIFACT_STACK,Math.floor(Number(x?.count)||1)))})).filter(x=>artifactById.has(x.id)):[];
  const artMap=new Map(); for(const a of s.artifacts){artMap.set(a.id,Math.min(MAX_ARTIFACT_STACK,(artMap.get(a.id)||0)+a.count));} s.artifacts=[...artMap.entries()].map(([id,count])=>({id,count}));
  const foundRaw=Array.isArray(raw.collectionFound)?raw.collectionFound.map(x=>Math.floor(Number(x))).filter(x=>itemById.has(x)):[];
  s.collectionFound=[...new Set(foundRaw.concat(s.inventory.filter(i=>itemById.get(i.id)?.category==='new_year').map(i=>i.id)))].slice(0,200);
  if(Array.isArray(raw.ownedAvatars)) s.ownedAvatars=[...new Set(raw.ownedAvatars.map(Number).map(Math.floor).filter(x=>avatarById.has(x)))].slice(0,AVATARS.avatars.length); if(!s.ownedAvatars.includes(1))s.ownedAvatars.unshift(1);
  s.selectedAvatar=avatarById.has(Number(raw.selectedAvatar))?Math.floor(Number(raw.selectedAvatar)):s.ownedAvatars[0]; if(!s.ownedAvatars.includes(s.selectedAvatar))s.selectedAvatar=s.ownedAvatars[0];
  if(Array.isArray(raw.ownedHouseBackgrounds)) s.ownedHouseBackgrounds=[...new Set(raw.ownedHouseBackgrounds.map(String).filter(x=>bgById.has(x)))].slice(0,100); if(!s.ownedHouseBackgrounds.includes('day')&&bgById.has('day'))s.ownedHouseBackgrounds.unshift('day');
  s.selectedHouseBackground=bgById.has(String(raw.selectedHouseBackground))&&s.ownedHouseBackgrounds.includes(String(raw.selectedHouseBackground))?String(raw.selectedHouseBackground):s.ownedHouseBackgrounds[0]||'day';
  s.adCoinsDayKey=typeof raw.adCoinsDayKey==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.adCoinsDayKey)?raw.adCoinsDayKey:'';
  s.adCoinsDailyCount=Math.max(0,Math.min(100,Math.floor(Number(raw.adCoinsDailyCount)||0)));
  s.houseCycle=Math.max(1,Math.min(100000,Math.floor(Number(raw.houseCycle)||1)));
  s.dailyRewardDay=Math.max(1,Math.min(30,Math.floor(Number(raw.dailyRewardDay)||1)));
  s.dailyRewardLastClaim=typeof raw.dailyRewardLastClaim==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(raw.dailyRewardLastClaim)?raw.dailyRewardLastClaim:'';
  if(raw.settings&&typeof raw.settings==='object'){s.settings.sound=raw.settings.sound!==false;if(skins.has(raw.settings.skin))s.settings.skin=raw.settings.skin;if(corners.has(raw.settings.corners))s.settings.corners=raw.settings.corners;s.settings.allowMessages=raw.settings.allowMessages!==false;}
  return s;
}

// v0.91 normalized read models. Legacy state_json remains the compatibility
// source during the staged migration, while every write atomically mirrors the
// wallet, grouped inventory, artifact stacks and progression into relational tables.
const PLAYER_PROJECTION_MIGRATION=4;
if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PLAYER_PROJECTION_MIGRATION)){
  const playerCount=Number(db.prepare('SELECT COUNT(*) c FROM players').get()?.c||0);
  if(playerCount>0){
    const backupDir=path.join(dbDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
    const stamp=new Date().toISOString().replace(/[:.]/g,'-');
    const backupPath=path.join(backupDir,`game-before-v91-projections-${stamp}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
    db.exec(`VACUUM INTO '${backupPath.replace(/'/g,"''")}'`);
    console.log(`[DB] Pre-v0.91 projection backup created: ${path.relative(ROOT,backupPath)}`);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    const players=db.prepare('SELECT id,state_json FROM players ORDER BY id').all();
    for(const row of players){
      let parsed;try{parsed=JSON.parse(row.state_json||'{}')}catch{throw new Error(`Некорректный state_json игрока #${row.id}; миграция остановлена без изменения данных.`)}
      const normalized=normalize(parsed);
      syncPlayerProjection(db,Number(row.id),normalized,{reason:'migration_v0_91',now:now()});
    }
    db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(PLAYER_PROJECTION_MIGRATION,now());
    db.exec('COMMIT');
    console.log(`[DB] v0.91 projections synchronized for ${players.length} players.`);
  }catch(error){try{db.exec('ROLLBACK')}catch{};throw error;}
}
const ACTION_REQUEST_MIGRATION=5;
if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(ACTION_REQUEST_MIGRATION)){
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(ACTION_REQUEST_MIGRATION,now());
}
const ACHIEVEMENT_REWARDS_MIGRATION=6;
if(!db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(ACHIEVEMENT_REWARDS_MIGRATION)){
  db.prepare('INSERT INTO schema_migrations(version,applied_at) VALUES(?,?)').run(ACHIEVEMENT_REWARDS_MIGRATION,now());
}

function publicState(playerId,state){
  const s=normalize(state),id=Number(playerId);
  // User-facing balances and inventory are read from normalized tables; the
  // legacy JSON remains only for the not-yet-split progression/quest settings.
  const wallet=db.prepare('SELECT coins,gems,shards FROM player_wallets WHERE player_id=?').get(id);
  if(wallet){s.coins=Number(wallet.coins);s.gems=Number(wallet.gems);s.shards=Number(wallet.shards);}
  const inventoryRows=db.prepare('SELECT item_id,tier,positions_json FROM player_inventory_stacks WHERE player_id=? ORDER BY last_position ASC').all(id);
  if(inventoryRows.length||!s.inventory.length){
    const projected=[];let valid=true;
    for(const row of inventoryRows){
      let positions=[];try{positions=JSON.parse(row.positions_json||'[]')}catch{valid=false;break;}
      for(const rawPosition of positions){
        const position=Math.floor(Number(rawPosition));
        if(position<0||position>=MAX_INVENTORY||projected[position]){valid=false;break;}
        projected[position]={id:Number(row.item_id),tier:Number(row.tier)};
      }
      if(!valid)break;
    }
    if(valid){
      const last=projected.reduce((n,item,index)=>item?index:n,-1);
      let contiguous=true;for(let index=0;index<=last;index++){if(!projected[index]){contiguous=false;break;}}
      if(last<0||contiguous)s.inventory=last<0?[]:projected.slice(0,last+1);
    }
  }
  const artifactRows=db.prepare('SELECT artifact_id,quantity FROM player_artifact_stacks WHERE player_id=? ORDER BY artifact_id').all(id);
  s.artifacts=artifactRows.map(row=>({id:Number(row.artifact_id),count:Number(row.quantity)}));
  const progression=db.prepare('SELECT level,experience,rating,total_cases_opened,house_level FROM player_progression_snapshot WHERE player_id=?').get(id);
  if(progression){s.level=Number(progression.level);s.experience=Number(progression.experience);s.rating=Number(progression.rating);s.totalCasesOpened=Number(progression.total_cases_opened);s.houseLevel=Number(progression.house_level);}
  return s;
}
const ACHIEVEMENTS=[
 {id:'first_case',title:'Первое открытие',description:'Открой первый кейс.',key:'cases',target:1,reward:{coins:150,gems:0,shards:0}},
 {id:'cases_50',title:'Первые находки',description:'Открой 50 кейсов.',key:'cases',target:50,reward:{coins:600,gems:2,shards:0}},
 {id:'cases_250',title:'Постоянный сталкер',description:'Открой 250 кейсов.',key:'cases',target:250,reward:{coins:2000,gems:5,shards:0}},
 {id:'cases_1000',title:'Мастер кейсов',description:'Открой 1 000 кейсов.',key:'cases',target:1000,reward:{coins:7500,gems:15,shards:0}},
 {id:'collector_10',title:'Начало коллекции',description:'Найди 10 разных предметов.',key:'found',target:10,reward:{coins:300,gems:0,shards:5}},
 {id:'collector_50',title:'Коллекционер',description:'Найди 50 разных предметов.',key:'found',target:50,reward:{coins:1500,gems:3,shards:15}},
 {id:'epic_drop',title:'Ценная находка',description:'Получи предмет IV редкости или выше.',key:'epic',target:1,reward:{coins:250,gems:1,shards:0}},
 {id:'legendary_drop',title:'Легендарная находка',description:'Получи предмет V редкости или выше.',key:'legendary',target:1,reward:{coins:700,gems:2,shards:0}},
 {id:'mythic_drop',title:'За гранью обычного',description:'Получи предмет VI редкости.',key:'mythic',target:1,reward:{coins:2500,gems:7,shards:0}},
 {id:'level_10',title:'Опытный выживший',description:'Достигни 10 уровня.',key:'level',target:10,reward:{coins:700,gems:0,shards:10}},
 {id:'level_25',title:'Ветеран зоны',description:'Достигни 25 уровня.',key:'level',target:25,reward:{coins:3000,gems:10,shards:20}},
 {id:'rare_streak_3',title:'Три находки подряд',description:'Получи три предмета IV редкости или выше подряд.',key:'rareStreak',target:3,reward:{coins:900,gems:3,shards:0}},
 {id:'big_opening_10',title:'Большое открытие',description:'Открой 10 кейсов за одну серию.',key:'bigOpening',target:1,reward:{coins:700,gems:2,shards:0}},
 {id:'active_days_7',title:'Постоянство',description:'Совершай игровые действия в семь разных дней.',key:'activeDays',target:7,reward:{coins:1000,gems:3,shards:5}},
 {id:'case_variety_5',title:'Исследователь',description:'Открой пять разных видов кейсов.',key:'caseTypes',target:5,reward:{coins:800,gems:2,shards:0}},
 {id:'cases_2500',title:'Опытный рейдер',description:'Открой 2 500 кейсов за всё время.',key:'cases',target:2500,reward:{coins:15000,gems:25,shards:35}},
 {id:'cases_5000',title:'Легенда Зоны',description:'Открой 5 000 кейсов за всё время.',key:'cases',target:5000,reward:{coins:35000,gems:60,shards:80}},
 {id:'cases_10000',title:'Повелитель кейсов',description:'Открой 10 000 кейсов за всё время.',key:'cases',target:10000,reward:{coins:80000,gems:120,shards:160}},
 {id:'collector_100',title:'Хранитель коллекции',description:'Найди 100 разных предметов.',key:'found',target:100,reward:{coins:12000,gems:20,shards:50}},
 {id:'collector_150',title:'Живая энциклопедия',description:'Найди 150 разных предметов.',key:'found',target:150,reward:{coins:30000,gems:55,shards:100}},
 {id:'level_50',title:'Командир убежища',description:'Достигни 50 уровня.',key:'level',target:50,reward:{coins:18000,gems:30,shards:45}},
 {id:'level_75',title:'Ветеран апокалипсиса',description:'Достигни 75 уровня.',key:'level',target:75,reward:{coins:35000,gems:65,shards:90}},
 {id:'level_100',title:'Легенда выживших',description:'Достигни 100 уровня.',key:'level',target:100,reward:{coins:75000,gems:120,shards:150}},
 {id:'case_variety_10',title:'Картограф Зоны',description:'Открой десять разных видов кейсов.',key:'caseTypes',target:10,reward:{coins:5000,gems:12,shards:20}},
 {id:'case_variety_20',title:'Исследователь миров',description:'Открой двадцать разных видов кейсов.',key:'caseTypes',target:20,reward:{coins:16000,gems:35,shards:60}},
 {id:'active_days_30',title:'Месяц в Зоне',description:'Совершай игровые действия в 30 разных дней.',key:'activeDays',target:30,reward:{coins:12000,gems:25,shards:40}},
 {id:'active_days_90',title:'Здесь твой дом',description:'Совершай игровые действия в 90 разных дней.',key:'activeDays',target:90,reward:{coins:40000,gems:80,shards:120}},
 {id:'rare_streak_5',title:'Охотник за редкостью',description:'Получи пять предметов IV редкости или выше подряд.',key:'rareStreak',target:5,reward:{coins:4500,gems:12,shards:25}},
 {id:'rare_streak_10',title:'Невероятная серия',description:'Получи десять предметов IV редкости или выше подряд.',key:'rareStreak',target:10,reward:{coins:18000,gems:45,shards:75}}
];
function buildProgressionData(playerId,state){
  const stats=db.prepare('SELECT cases,openings,best_tier FROM player_case_stats WHERE player_id=?').get(playerId)||{};
  const foundRows=db.prepare('SELECT DISTINCT item_id FROM case_opening_drops WHERE player_id=?').all(playerId);
  const found=new Set(foundRows.map(row=>Number(row.item_id)));
  for(const item of state.inventory)found.add(Number(item.id));
  const foundIds=[...found].filter(id=>itemById.has(id));
  const recordedTier=Number(db.prepare('SELECT COALESCE(MAX(tier),0) tier FROM case_opening_drops WHERE player_id=?').get(playerId)?.tier||0);
  const maxTier=Math.max(recordedTier,...state.inventory.map(item=>Number(item.tier)||0));
  const rareRows=db.prepare('SELECT tier FROM case_opening_drops WHERE player_id=? ORDER BY id DESC LIMIT 100').all(playerId);
  let rareStreak=0;for(const row of rareRows){if(Number(row.tier)>=4)rareStreak++;else break;}
  const bigOpening=Number(db.prepare('SELECT EXISTS(SELECT 1 FROM case_openings WHERE player_id=? AND quantity>=10) AS value').get(playerId)?.value||0);
  const activeDays=Number(db.prepare('SELECT COUNT(DISTINCT day_utc) AS value FROM player_activity_daily WHERE player_id=?').get(playerId)?.value||0);
  const caseTypes=Number(db.prepare('SELECT COUNT(DISTINCT case_id) AS value FROM case_openings WHERE player_id=?').get(playerId)?.value||0);
  const progress={cases:Number(stats.cases||0),found:foundIds.length,epic:maxTier>=4?1:0,legendary:maxTier>=5?1:0,mythic:maxTier>=6?1:0,level:Math.max(1,Number(state.level)||1),rareStreak,bigOpening,activeDays,caseTypes};
  const claimed=new Set(db.prepare('SELECT achievement_id FROM player_achievement_claims WHERE player_id=?').all(playerId).map(row=>String(row.achievement_id)));
  const achievements=ACHIEVEMENTS.map(a=>{const value=progress[a.key]||0,completed=value>=a.target,isClaimed=claimed.has(a.id);return {...a,progress:value,completed,claimed:isClaimed,claimable:completed&&!isClaimed};});
  const labels={weapons:'Арсенал',new_year:'Особые находки',details:'Снаряжение',ore:'Минералы и кристаллы',fish:'Пища и улов',medic:'Медицина',head:'Головные уборы',resources:'Ресурсы',body:'Защита',boots:'Обувь'};
  const collections=[...new Set(ITEMS.items.map(item=>item.category||'other'))].map(category=>{
    const items=ITEMS.items.filter(item=>(item.category||'other')===category).map(item=>({id:Number(item.id),name:item.name,image:item.image,found:found.has(Number(item.id))}));
    return {id:category,title:labels[category]||category,found:items.filter(item=>item.found).length,total:items.length,items};
  }).sort((a,b)=>a.title.localeCompare(b.title,'ru'));
  return {ok:true,foundCount:foundIds.length,totalItems:ITEMS.items.length,achievements,collections};
}
function artifactCount(state,id){return Math.max(0,Math.floor(Number(state.artifacts?.find(a=>a.id===Number(id))?.count||0)));}
function canAddArtifact(state,id,count=1){return artifactById.has(Number(id))&&Number.isSafeInteger(count)&&count>0&&artifactCount(state,id)+count<=MAX_ARTIFACT_STACK;}
function addArtifact(state,id,count=1){if(!canAddArtifact(state,id,count))return false;const row=state.artifacts.find(x=>x.id===Number(id));if(row)row.count+=count;else state.artifacts.push({id:Number(id),count});return true;}
function bumpRareQuest(state,t=now(),count=1){const n=Math.max(0,Math.floor(Number(count)||0));if(n)bumpQuest(state,'rare',n,t);}
function removeArtifact(state,id,count=1){const row=state.artifacts.find(x=>x.id===Number(id));const n=Math.max(1,Math.floor(Number(count)||1));if(!row||row.count<n)return false;row.count-=n;if(row.count<=0)state.artifacts=state.artifacts.filter(x=>x.id!==Number(id));return true;}
function markCollection(state,id){const item=itemById.get(Number(id));if(item?.category==='new_year'&&!state.collectionFound.includes(Number(id)))state.collectionFound.push(Number(id));}
function itemPrice(id,tier){const item=itemById.get(Number(id));return Number(item?.tiers?.[String(tier)]?.price||0);}
function makeInventoryItem(id,tier){const item=itemById.get(Number(id));if(!item||!item.tiers?.[String(tier)])throw new Error('Предмет недоступен.');return {id:item.id,tier:Number(tier)};}
function validCaseTable(c){return (c?.dropTable||[]).filter(d=>itemById.has(Number(d.itemId))&&Number(d.chance)>0&&Number(d.tier)>=1&&Number(d.tier)<=6);}
function pickDrop(c){const table=validCaseTable(c);if(!table.length)throw new Error('В кейсе нет доступных предметов.');const chosen=weightedPick(table);return {item:makeInventoryItem(chosen.itemId,chosen.tier),tier:Number(chosen.tier)};}
function caseExp(c){const a=Array.isArray(c?.exp)?Number(c.exp[0]):20,b=Array.isArray(c?.exp)?Number(c.exp[1]):20;return randomInt(Math.min(a,b),Math.max(a,b));}
function caseRating(c){const a=Array.isArray(c?.rating)?Number(c.rating[0]):1,b=Array.isArray(c?.rating)?Number(c.rating[1]):2;return Math.max(0,randomInt(Math.min(a,b),Math.max(a,b)));}
function addExp(state,xp){const n=Math.max(0,Math.floor(Number(xp)||0));if(n)bumpQuest(state,'xp',n,now());return levelUp(state,n);}
function houseIncome(state,t=now()){
  const h=houseByLevel.get(state.houseLevel)||houseByLevel.get(1); const elapsed=Math.max(0,t-state.lastHouseCollectTime); const minutes=Math.min(MAX_HOUSE_COLLECT_MINUTES,Math.floor(elapsed/60000)); return Math.max(0,minutes*Number(h?.incomePerMinute||0));
}
function applyIncome(state,t=now()){const income=houseIncome(state,t);if(income>0){addCoins(state,income,t);state.houseIncomeEarned+=income;state.lastHouseCollectTime=t;}return income;}
function countReq(inv,req){return inv.filter(i=>i.id===Number(req.itemId)&&i.tier===Number(req.tier)).length;}
function removeRequirements(inv,reqs){for(const req of reqs||[]){let left=Math.max(0,Math.floor(Number(req.count)||0));for(let i=inv.length-1;i>=0&&left>0;i--)if(inv[i].id===Number(req.itemId)&&inv[i].tier===Number(req.tier)){inv.splice(i,1);left--; }if(left>0)throw new Error('Не хватает предметов.');}}
function dateKeys(t=now()){
  // Задания живут по московскому времени: UTC+3, без переходов на летнее время.
  const MSK_OFFSET_MS=3*60*60*1000;
  const msk=new Date(Number(t)+MSK_OFFSET_MS);
  const date=msk.toISOString().slice(0,10);
  const dow=msk.getUTCDay();
  const daysFromMonday=(dow+6)%7;
  const mondayMs=msk.getTime()-daysFromMonday*86400000;
  const weekStart=new Date(mondayMs).toISOString().slice(0,10);
  const nextDayUtc=Date.parse(date+'T00:00:00Z')-MSK_OFFSET_MS+86400000;
  const nextWeekUtc=Date.parse(weekStart+'T00:00:00Z')-MSK_OFFSET_MS+7*86400000;
  return {date,weekStart,dailyResetAt:nextDayUtc,weeklyResetAt:nextWeekUtc};
}
function ruPlural(n,one,few,many){const x=Math.abs(Number(n)||0)%100, y=x%10;return x>=11&&x<=14?many:y===1?one:(y>=2&&y<=4?few:many);}
function questPool(state){
  const level=Math.max(1,Number(state?.level)||1);
  const scale=1+Math.min(2.2,(level-1)/55);
  const scaled=(a,b)=>[Math.max(1,Math.round(a*scale)),Math.max(Math.round(a*scale),Math.round(b*scale))];
  const caseName=n=>ruPlural(n,'кейс','кейса','кейсов'), contractName=n=>ruPlural(n,'контракт','контракта','контрактов');
  const timeName=n=>ruPlural(n,'раз','раза','раз');
  const itemName=n=>ruPlural(n,'предмет','предмета','предметов');
  const levelName=n=>ruPlural(n,'новый уровень','новых уровня','новых уровней');
  const gemName=n=>ruPlural(n,'гем','гема','гемов');
  return [
    {id:'cases_low',minLevel:1,label:n=>'Открыть '+n+' '+caseName(n),key:'cases',range:scaled(3,7),rating:[6,10]},
    {id:'cases_mid',minLevel:8,label:n=>'Открыть '+n+' '+caseName(n),key:'cases',range:scaled(8,16),rating:[12,22]},
    {id:'cases_high',minLevel:25,label:n=>'Открыть '+n+' '+caseName(n),key:'cases',range:scaled(18,35),rating:[24,42]},
    {id:'coins_low',minLevel:1,label:n=>'Заработать '+n.toLocaleString('ru-RU')+' монет',key:'coins',range:scaled(1000,4000),rating:[8,14]},
    {id:'coins_mid',minLevel:8,label:n=>'Заработать '+n.toLocaleString('ru-RU')+' монет',key:'coins',range:scaled(5000,15000),rating:[15,26]},
    {id:'coins_high',minLevel:25,label:n=>'Заработать '+n.toLocaleString('ru-RU')+' монет',key:'coins',range:scaled(18000,45000),rating:[28,50]},
    {id:'sell_low',minLevel:1,label:n=>'Продать предметов на '+n.toLocaleString('ru-RU')+' монет',key:'sell',range:scaled(1500,6000),rating:[8,14]},
    {id:'sell_mid',minLevel:8,label:n=>'Продать предметов на '+n.toLocaleString('ru-RU')+' монет',key:'sell',range:scaled(7000,22000),rating:[15,28]},
    {id:'sell_high',minLevel:25,label:n=>'Продать предметов на '+n.toLocaleString('ru-RU')+' монет',key:'sell',range:scaled(25000,60000),rating:[30,52]},
    {id:'contracts_low',minLevel:1,label:n=>'Выполнить '+n+' '+contractName(n),key:'contracts',range:[1,2],rating:[5,9]},
    {id:'contracts_mid',minLevel:8,label:n=>'Выполнить '+n+' '+contractName(n),key:'contracts',range:[2,4],rating:[12,22]},
    {id:'contracts_high',minLevel:25,label:n=>'Выполнить '+n+' '+contractName(n),key:'contracts',range:[5,8],rating:[24,38]},
    {id:'house_low',minLevel:3,label:n=>'Улучшить дом '+n+' '+timeName(n),key:'house',range:[1,1],rating:[12,16]},
    {id:'house_high',minLevel:10,label:n=>'Улучшить дом '+n+' '+timeName(n),key:'house',range:[1,1],rating:[24,40]},
    {id:'house_collect_low',minLevel:1,label:n=>'Собрать доход дома '+n+' '+timeName(n),key:'houseCollect',range:[1,2],rating:[8,14]},
    {id:'house_collect_high',minLevel:15,label:n=>'Собрать доход дома '+n+' '+timeName(n),key:'houseCollect',range:[3,5],rating:[18,30]},
    {id:'spend_low',minLevel:1,label:n=>'Потратить '+n.toLocaleString('ru-RU')+' монет',key:'spend',range:scaled(1000,3500),rating:[7,12]},
    {id:'spend_high',minLevel:20,label:n=>'Потратить '+n.toLocaleString('ru-RU')+' монет',key:'spend',range:scaled(8000,28000),rating:[18,34]},
    {id:'gems_low',minLevel:1,label:n=>'Получить '+n+' '+gemName(n),key:'gems',range:[1,3],rating:[8,14]},
    {id:'gems_high',minLevel:15,label:n=>'Получить '+n+' '+gemName(n),key:'gems',range:[3,8],rating:[20,36]},
    {id:'xp_low',minLevel:1,label:n=>'Получить '+n.toLocaleString('ru-RU')+' опыта',key:'xp',range:scaled(75,250),rating:[8,14]},
    {id:'xp_high',minLevel:20,label:n=>'Получить '+n.toLocaleString('ru-RU')+' опыта',key:'xp',range:scaled(350,900),rating:[20,36]},
    {id:'rare_low',minLevel:5,label:n=>'Получить '+n+' '+itemName(n)+' (III–VI)',key:'rare',range:[1,3],rating:[10,18]},
    {id:'rare_high',minLevel:20,label:n=>'Получить '+n+' '+itemName(n)+' (III–VI)',key:'rare',range:[4,8],rating:[20,36]},
    {id:'levels_low',minLevel:3,label:n=>'Получить '+n+' '+levelName(n),key:'levels',range:[1,1],rating:[10,18]},
    {id:'levels_high',minLevel:30,label:n=>'Получить '+n+' '+levelName(n),key:'levels',range:[1,1],rating:[24,42]},
    {id:'cases_marathon',minLevel:15,label:n=>'Открыть '+n+' '+caseName(n),key:'cases',range:scaled(12,22),rating:[18,30]},
    {id:'house_collect_mid',minLevel:5,label:n=>'Собрать доход дома '+n+' '+timeName(n),key:'houseCollect',range:[2,3],rating:[12,20]},
    {id:'contracts_short',minLevel:3,label:n=>'Выполнить '+n+' '+contractName(n),key:'contracts',range:[1,2],rating:[8,12]}
  ].filter(q=>level>=q.minLevel && (q.key!=='house'||(Number(state?.houseLevel)||1)<5));
}
function seededUnit(seed){let x=(Math.abs(Math.floor(Number(seed)||1))%2147483646)+1;x=(x*48271)%2147483647;return x/2147483647;}
function randBetweenSeed(a,b,seed){return Math.floor(Math.min(a,b)+seededUnit(seed)*(Math.max(a,b)-Math.min(a,b)+1));}
function questLabel(q){const n=Math.max(1,Number(q?.target)||1),key=String(q?.key||'');const caseName=ruPlural(n,'кейс','кейса','кейсов'),contractName=ruPlural(n,'контракт','контракта','контрактов'),timeName=ruPlural(n,'раз','раза','раз'),itemName=ruPlural(n,'предмет','предмета','предметов'),gemName=ruPlural(n,'гем','гема','гемов'),levelName=ruPlural(n,'новый уровень','новых уровня','новых уровней');const m={cases:`Открыть ${n} ${caseName}`,coins:`Заработать ${n.toLocaleString('ru-RU')} монет`,sell:`Продать предметов на ${n.toLocaleString('ru-RU')} монет`,contracts:`Выполнить ${n} ${contractName}`,house:`Улучшить дом ${n} ${timeName}`,houseCollect:`Собрать доход дома ${n} ${timeName}`,spend:`Потратить ${n.toLocaleString('ru-RU')} монет`,gems:`Получить ${n} ${gemName}`,xp:`Получить ${n.toLocaleString('ru-RU')} опыта`,rare:`Получить ${n} ${itemName} (III–VI)`,levels:`Получить ${n} ${levelName}`};return m[key]||`Выполнить: ${n}`;}
function makeQuest(template,prefix,index,weekly=false,seed=1){const salt=template.id.split('').reduce((n,ch)=>((n*31+ch.charCodeAt(0))%2147483647),17);let target=randBetweenSeed(template.range[0],template.range[1],Number(seed)+salt+index*7919);let rating=randBetweenSeed(template.rating[0],template.rating[1],Number(seed)+salt+index*104729);if(weekly){const mult={cases:2.4,coins:3,sell:3,contracts:2.5,house:1,rare:2.2,levels:1,houseCollect:2.5,spend:2.7,gems:1.8,xp:2.4}[template.key]||2.5;target=['house','levels'].includes(template.key)?1:Math.max(target+1,Math.round(target*mult));rating=Math.max(rating+10,Math.round(rating*2.0));}const reward=rollQuestCurrencyRewards(weekly,seed,salt);return {id:`${prefix}_${index}_${template.id}_${target}`,key:template.key,target,rating,reward};}
function shuffle(a,seed){const out=[...a];let x=Math.abs(Math.floor(seed))%2147483647||1;for(let i=out.length-1;i>0;i--){x=(x*48271)%2147483647;const j=x%(i+1);[out[i],out[j]]=[out[j],out[i]];}return out;}
function buildPeriodQuests(prefix,count,seed,weekly=false,state=null){
  const pool=questPool(state); const chosen=[]; const used=new Set();
  for(const key of shuffle([...new Set(pool.map(q=>q.key))],seed)){
    const variants=shuffle(pool.filter(q=>q.key===key),seed+key.length*97); const v=variants[0]; chosen.push(makeQuest(v,prefix,chosen.length,weekly,seed)); used.add(v.id); if(chosen.length>=count)break;
  }
  const chosenKeys=new Set(chosen.map(q=>q.key));const rest=shuffle(pool.filter(q=>!used.has(q.id)&&!chosenKeys.has(q.key)),seed+777);
  while(chosen.length<count&&rest.length) chosen.push(makeQuest(rest.shift(),prefix,chosen.length,weekly,seed+31337));
  return chosen;
}
function expandPeriodQuests(existing,prefix,count,seed,weekly=false,state=null){
  const kept=Array.isArray(existing)?existing.slice(0,count):[];
  if(kept.length>=count)return kept;
  const generated=buildPeriodQuests(prefix,count,seed,weekly,state);
  const ids=new Set(kept.map(q=>String(q.id||'')));
  const keys=new Set(kept.map(q=>String(q.key||'')));
  const candidates=generated.filter(q=>!ids.has(String(q.id||''))&&!keys.has(String(q.key||'')));
  const additions=[...candidates,...generated.filter(q=>!ids.has(String(q.id||''))&&!candidates.includes(q))];
  for(const q of additions){if(kept.length>=count)break;kept.push(q);ids.add(String(q.id||''));keys.add(String(q.key||''));}
  return kept.length===count?kept:buildPeriodQuests(prefix,count,seed,weekly,state);
}
function ensureQuestState(state,t=now()){
  const {date,weekStart}=dateKeys(t);
  if(state.dailyQuestKey!==(':'+date)){
    state.dailyQuestKey=':'+date; state.dailyQuestProgress={...DEFAULT.dailyQuestProgress}; state.dailyQuestClaimed=[]; state._dailySeed=randomInt(0,999999999);
    state.dailyQuests=buildPeriodQuests('d',8,state._dailySeed,false,state);
  } else if(!Array.isArray(state.dailyQuests)||state.dailyQuests.length!==8){state.dailyQuests=expandPeriodQuests(state.dailyQuests,'d',8,Number(state._dailySeed)||17,false,state);}
  if(state.weeklyQuestKey!==(':'+weekStart)){
    state.weeklyQuestKey=':'+weekStart; state.weeklyQuestProgress={...DEFAULT.weeklyQuestProgress}; state.weeklyQuestClaimed=[]; state._weeklySeed=randomInt(0,999999999);
    state.weeklyQuests=buildPeriodQuests('w',6,state._weeklySeed,true,state);
  } else if(!Array.isArray(state.weeklyQuests)||state.weeklyQuests.length!==6){state.weeklyQuests=expandPeriodQuests(state.weeklyQuests,'w',6,Number(state._weeklySeed)||31,true,state);}
  // Migrate stored quests without resetting progress or claims.
  const repairRewards=(list,weekly,seed)=>list.forEach((q,index)=>{const salt=String(q.id||index).split('').reduce((n,ch)=>((n*31+ch.charCodeAt(0))%2147483647),17);q.reward=repairQuestCurrencyRewards(q.reward,weekly,seed,salt);});
  repairRewards(state.dailyQuests,false,state._dailySeed);repairRewards(state.weeklyQuests,true,state._weeklySeed);
}
function questDefs(state,t=now()){
  ensureQuestState(state,t);
  const decorate=list=>list.map(q=>({...q,label:questLabel(q)}));
  return {daily:decorate(state.dailyQuests),weekly:decorate(state.weeklyQuests)};
}
function bumpQuest(state,key,amount=1,t=now()){
  ensureQuestState(state,t); const n=Math.max(0,Number(amount)||0);
  state.dailyQuestProgress[key]=Math.min(100000000,(state.dailyQuestProgress[key]||0)+n);
  state.weeklyQuestProgress[key]=Math.min(100000000,(state.weeklyQuestProgress[key]||0)+n);
}
function addCoins(state,amount,t=now()){const n=Math.max(0,Math.floor(Number(amount)||0));if(!n)return 0;state.coins+=n;state.totalCoinsEarned+=n;bumpQuest(state,'coins',n,t);return n;}
function addRating(state,amount){state.rating=Math.max(0,Math.min(1000000000,Math.floor(state.rating+amount)));}
function getSession(req){const sid=cookies(req).sid;if(!sid)return null;return db.prepare('SELECT p.* FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token_hash=? AND s.expires_at>?').get(tokenHash(sid),now())||null;}
function cookies(req){const o={};for(const p of String(req.headers.cookie||'').split(';')){const i=p.indexOf('=');if(i>0)try{o[p.slice(0,i).trim()]=decodeURIComponent(p.slice(i+1).trim())}catch{}}return o;}
function out(res,status,data,extra={}){const b=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin','Content-Length':Buffer.byteLength(b),...extra});res.end(b);}
function err(res,status,msg){return out(res,status,{ok:false,error:String(msg)});}
function body(req){return new Promise((resolve,reject)=>{let s='',n=0,done=false;req.on('data',c=>{if(done)return;n+=c.length;if(n>262144){done=true;reject(new Error('Слишком большой запрос'));req.destroy();return;}s+=c});req.on('end',()=>{if(done)return;try{resolve(s?JSON.parse(s):{})}catch{reject(new Error('Некорректный JSON'))}});req.on('error',reject)});}
function session(res,id){const t=crypto.randomBytes(32).toString('base64url'),ttl=2592000,ts=now();db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(tokenHash(t),id,ts,ts+ttl);db.prepare('DELETE FROM sessions WHERE player_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE player_id=? ORDER BY created_at DESC LIMIT 5)').run(id,id);res.setHeader('Set-Cookie',`sid=${encodeURIComponent(t)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ttl}${COOKIE_SECURE?'; Secure':''}`);}
function validUser(u){return /^[A-Za-z0-9_]{3,20}$/.test(u)}
function createPlayerActionRequestContext(playerId,requestId,actionType,payload){
  const id=String(requestId||'').trim();if(!id)return null;
  if(!/^[A-Za-z0-9._:-]{8,128}$/.test(id))throw new Error('Некорректный ключ игрового действия.');
  const hash=crypto.createHash('sha256').update(JSON.stringify({action:actionType,payload})).digest('hex');
  const prior=db.prepare('SELECT action_type,payload_hash,result_json FROM player_action_requests WHERE player_id=? AND request_id=?').get(Number(playerId),id);
  if(prior&&(prior.action_type!==actionType||prior.payload_hash!==hash))throw new Error('Ключ уже использован для другого действия.');
  return {playerId:Number(playerId),id,actionType,hash,prior:prior?JSON.parse(prior.result_json||'null'):null,replayed:!!prior};
}
function savePlayerActionRequest(context,result){
  if(!context||context.replayed)return;
  db.prepare('INSERT INTO player_action_requests(player_id,request_id,action_type,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?)')
    .run(context.playerId,context.id,context.actionType,context.hash,JSON.stringify(result||null),now());
}
function replayPlayerActionRequest(res,context){
  if(!context?.replayed)return false;
  const row=db.prepare('SELECT state_json FROM players WHERE id=?').get(context.playerId);
  if(!row)throw new Error('Игрок не найден.');
  out(res,200,{ok:true,state:publicState(context.playerId,normalize(JSON.parse(row.state_json))),result:context.prior,...(context.prior&&typeof context.prior==='object'?context.prior:{}),replayed:true});
  return true;
}
function persistPlayerStateRow(playerId,state,expectedVersion=null,ts=now(),meta={}){
  const s=normalize(state),savepoint=`player_state_save_${crypto.randomBytes(4).toString('hex')}`;
  db.exec(`SAVEPOINT ${savepoint}`);
  try{
    let r;
    if(expectedVersion!==null&&Number.isFinite(Number(expectedVersion))){
      r=db.prepare('UPDATE players SET state_json=?,updated_at=?,state_version=state_version+1 WHERE id=? AND state_version=?').run(JSON.stringify(s),ts,playerId,Math.max(0,Math.floor(Number(expectedVersion))));
      if(!r.changes)throw new Error('Состояние игрока изменилось. Повтори действие.');
    }else{
      r=db.prepare('UPDATE players SET state_json=?,updated_at=?,state_version=state_version+1 WHERE id=?').run(JSON.stringify(s),ts,playerId);
      if(!r.changes)throw new Error('Игрок не найден.');
    }
    syncPlayerProjection(db,Number(playerId),s,{now:ts,reason:meta.reason||'state_sync',operationId:meta.operationId||null});
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return s;
  }catch(error){try{db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)}catch{};try{db.exec(`RELEASE SAVEPOINT ${savepoint}`)}catch{};throw error;}
}
function commitState(playerId,state,expectedVersion=null,meta={}){
  const s=persistPlayerStateRow(playerId,state,expectedVersion,now(),meta);
  return publicState(playerId,s);
}
function beginStateOperation(type,playerId,payload){const opId=crypto.randomUUID();const ts=now();db.prepare('INSERT INTO state_operations(op_id,type,player_id,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(opId,String(type),Number(playerId),JSON.stringify(payload), 'pending',ts,ts);return opId;}
function finishStateOperation(opId){db.prepare("UPDATE state_operations SET status='committed',updated_at=? WHERE op_id=?").run(now(),String(opId));}
function recoverPendingStateOperations(){
  const rows=db.prepare("SELECT * FROM state_operations WHERE status='pending' ORDER BY created_at ASC LIMIT 100").all();
  for(const row of rows){
    try{
      const payload=JSON.parse(row.payload_json||'{}');
      if(row.type==='market'){
        const order=payload.kind==='buy'?marketDb.prepare("SELECT * FROM orders WHERE id=? AND status='sold' AND buyer_id=?").get(Number(payload.listingId),Number(row.player_id)):payload.kind==='cancel'?marketDb.prepare("SELECT * FROM orders WHERE id=? AND status='cancelled'").get(Number(payload.listingId)):marketDb.prepare('SELECT * FROM orders WHERE operation_id=?').get(String(row.op_id));
        // Market + player mutations now commit in one SQLite transaction. If no
        // matching order state exists, the transaction never committed; do not
        // restore an old JSON snapshot over newer player progress.
        if(!order){
          if(payload.atomicDb) db.prepare("UPDATE state_operations SET status='cancelled',updated_at=? WHERE op_id=?").run(now(),row.op_id);
          else {
            // Recovery of a pre-v0.89 two-database saga: the legacy game DB may
            // have committed before the old market DB did. Restore its recorded
            // snapshot only for those legacy operations.
            db.exec('BEGIN IMMEDIATE');try{
              for(const item of payload.beforeStates||[])persistPlayerStateRow(Number(item.playerId),item.state,null,now(),{reason:'market_recovery',operationId:row.op_id});
              db.prepare('DELETE FROM player_mail WHERE operation_id=?').run(row.op_id);
              db.prepare("UPDATE state_operations SET status='cancelled',updated_at=? WHERE op_id=?").run(now(),row.op_id);
              db.exec('COMMIT');
            }catch(e){db.exec('ROLLBACK');throw e;}
          }
        } else finishStateOperation(row.op_id);
      } else finishStateOperation(row.op_id);
    }catch(e){console.warn('[STATE RECOVERY]',row.op_id,e.message)}
  }
  db.prepare("DELETE FROM state_operations WHERE status='committed' AND updated_at<?").run(now()-7*24*60*60*1000);
  db.prepare('DELETE FROM player_action_requests WHERE created_at<?').run(now()-30*24*60*60*1000);
}
recoverPendingStateOperations();

function recordPlayerActivity(playerId,sessionHash){
 const t=now(),day=new Date(t).toISOString().slice(0,10);
 db.prepare(`INSERT INTO player_activity_daily(player_id,day_utc,action_count,last_active_at) VALUES(?,?,1,?)
 ON CONFLICT(player_id,day_utc) DO UPDATE SET action_count=action_count+1,last_active_at=excluded.last_active_at`).run(Number(playerId),day,t);
 if(sessionHash)db.prepare(`INSERT INTO player_presence(session_hash,player_id,last_seen_at,last_action_at,client_kind) VALUES(?,?,?,?,'web')
 ON CONFLICT(session_hash) DO UPDATE SET player_id=excluded.player_id,last_seen_at=excluded.last_seen_at,last_action_at=excluded.last_action_at`).run(String(sessionHash),Number(playerId),t,t);
}
function action(playerId,rawState,type,payload,playerRow=null){
  const state=normalize(rawState), t=now();
  switch(type){
    case 'openCase':{
      const id=Math.floor(Number(payload?.caseId)), c=caseById.get(id); if(!c)throw new Error('Кейс не найден.');
      const quantity=validateQuantity(payload?.quantity??1);
      if(c.isAd&&quantity!==1)throw new Error('Рекламный кейс открывается только по одному.');
      if(c.requiredLevel&&state.level<Number(c.requiredLevel))throw new Error('Недостаточный уровень.');
      if(state.inventory.length+quantity>MAX_INVENTORY)throw new Error(`Недостаточно места в инвентаре: нужно ${quantity} свободных ячеек.`);
      const unitCost=c.isAd?0:Math.max(0,Math.floor(Number(c.price)||0));
      const totalCost=unitCost*quantity;
      if(!Number.isSafeInteger(totalCost))throw new Error('Некорректная стоимость кейса.');
      if(c.isAd){if(t-state.lastAdCaseTime<AD_CASE_COOLDOWN_MS)throw new Error(`Рекламный кейс будет доступен через ${Math.ceil((AD_CASE_COOLDOWN_MS-(t-state.lastAdCaseTime))/1000)} сек.`);state.lastAdCaseTime=t;}
      else if(c.currency==='gems'){if(state.gems<totalCost)throw new Error('Недостаточно гемов.');state.gems-=totalCost;}
      else {if(state.coins<totalCost)throw new Error('Недостаточно монет.');state.coins-=totalCost;bumpQuest(state,'spend',totalCost,t);}
      const fastFeeGems=payload?.fast?quantity:0;
      if(fastFeeGems){if(state.gems<fastFeeGems)throw new Error(`Для быстрого открытия нужно ${fastFeeGems} гем${fastFeeGems===1?'':'ов'}.`);state.gems-=fastFeeGems;}
      const items=[];let totalXp=0,totalRating=0,totalLevels=0,totalLevelCoins=0,totalLevelGems=0;
      for(let index=0;index<quantity;index++){
        const drop=pickDrop(c),xp=caseExp(c),caseRatingGain=caseRating(c);
        state.inventory.push(drop.item);markCollection(drop.item.id);state.totalCasesOpened++;
        const level=addExp(state,xp);totalXp+=xp;totalLevels+=Number(level.levels||0);totalLevelCoins+=Number(level.coinReward||0);totalLevelGems+=Number(level.gemReward||0);
        if(drop.tier>=3)bumpQuest(state,'rare',1,t);
        addRating(state,caseRatingGain);bumpQuest(state,'cases',1,t);totalRating+=caseRatingGain;
        items.push({item:clientItem(drop.item.id,drop.item.tier),tier:drop.tier,xp,level,rating:caseRatingGain});
      }
      return {state,result:{item:items[0].item,tier:items[0].tier,items,quantity,totalCost,currency:c.currency||'coins',fastFeeGems,totalXp,totalRating,totalLevels,totalLevelCoins,totalLevelGems}};
    }
    case 'collectHouse':{const income=applyIncome(state,t);if(!income)throw new Error('Дом пока не принёс доход.');bumpQuest(state,'houseCollect',1,t);return {state,result:{income}};}
    case 'upgradeHouse':{
      const current=houseByLevel.get(state.houseLevel);if(!current)throw new Error('Уровень дома недоступен.');const next=houseByLevel.get(state.houseLevel+1);if(!next)throw new Error('Максимальный уровень дома.');applyIncome(state,t);
      const cc=Math.max(0,Math.floor(Number(current.upgradeCostCoins)||0)),cg=Math.max(0,Math.floor(Number(current.upgradeCostGems)||0));for(const req of current.requiredItems||[])if(countReq(state.inventory,req)<Number(req.count))throw new Error('Не хватает предметов.');if(state.coins<cc)throw new Error('Недостаточно монет.');if(state.gems<cg)throw new Error('Недостаточно гемов.');removeRequirements(state.inventory,current.requiredItems||[]);state.coins-=cc;state.gems-=cg;if(cc)bumpQuest(state,'spend',cc,t);state.houseLevel++;state.lastHouseCollectTime=t;const upgradeRating=Math.max(5,Math.min(15,Math.floor(Number(current.upgradeRating)||5)));addRating(state,upgradeRating);bumpQuest(state,'house',1,t);return {state,result:{houseLevel:state.houseLevel,rating:upgradeRating}};
    }
    case 'sellHouse':{
      if(state.houseLevel<30) throw new Error('Продать убежище можно только на 30 уровне.');
      applyIncome(state,t);
      state.houseLevel=1;
      state.lastHouseCollectTime=t;
      state.houseIncomeEarned=0;
      state.houseCycle=Math.min(100000,state.houseCycle+1);
      const gemsReward=50, ratingReward=500;
      state.gems=Math.min(1000000000,state.gems+gemsReward);
      addRating(state,ratingReward);
      return {state,result:{houseLevel:1,gems:gemsReward,rating:ratingReward}};
    }
    case 'buyBackground':{
      const id=String(payload?.bgId||''),bg=bgById.get(id);if(!bg)throw new Error('Фон не найден.');if(!state.ownedHouseBackgrounds.includes(id)){const price=Math.max(0,Math.floor(Number(bg.price)||0));if(bg.currency==='gems'){if(state.gems<price)throw new Error('Недостаточно гемов.');state.gems-=price;}else{if(state.coins<price)throw new Error('Недостаточно монет.');state.coins-=price;bumpQuest(state,'spend',price,t);}state.ownedHouseBackgrounds.push(id);}state.selectedHouseBackground=id;return {state};
    }
    case 'selectAvatar':{
      const id=Math.floor(Number(payload?.avatarId)),a=avatarById.get(id);if(!a)throw new Error('Аватар не найден.');
      if(!state.ownedAvatars.includes(id)){const price=Math.max(0,Math.floor(Number(a.price)||0));if(a.currency==='gems'){if(state.gems<price)throw new Error('Недостаточно гемов.');state.gems-=price;}else{if(state.coins<price)throw new Error('Недостаточно монет.');state.coins-=price;bumpQuest(state,'spend',price,t);}state.ownedAvatars.push(id);}
      state.selectedAvatar=id;state.lastAvatarChangeTime=t;return {state};
    }
    case 'sell':{
      const indices=Array.isArray(payload?.indices)?[...new Set(payload.indices.map(x=>Math.floor(Number(x))).filter(Number.isInteger))].sort((a,b)=>b-a):[];if(!indices.length)throw new Error('Выберите предметы.');if(indices.some(i=>i<0||i>=state.inventory.length))throw new Error('Инвентарь изменился, обновите окно.');let total=0;for(const i of indices)total+=itemPrice(state.inventory[i].id,state.inventory[i].tier);for(const i of indices)state.inventory.splice(i,1);addCoins(state,total,t);addRating(state,Math.min(60,Math.floor(total/1000)));bumpQuest(state,'sell',total,t);return {state,result:{coins:total,count:indices.length}};
    }
    case 'sellAll':{let total=0;for(const i of state.inventory)total+=itemPrice(i.id,i.tier);const count=state.inventory.length;state.inventory=[];addCoins(state,total,t);addRating(state,Math.min(100,Math.floor(total/1000)));bumpQuest(state,'sell',total,t);return {state,result:{coins:total,count}};}
    case 'contract':{
      const indices=Array.isArray(payload?.indices)?[...new Set(payload.indices.map(x=>Math.floor(Number(x))).filter(Number.isInteger))]:[];if(indices.length<3||indices.length>9)throw new Error('Контракт: 3–9 предметов.');if(indices.some(i=>i<0||i>=state.inventory.length))throw new Error('Инвентарь изменился, обновите окно.');let total=0;for(const i of indices)total+=itemPrice(state.inventory[i].id,state.inventory[i].tier);const r=randomFloat();const mult=r<.45?randomBetween(.55,.85):r<.85?randomBetween(.95,1.25):randomBetween(1.35,1.75);const target=total*mult;let best=null,diff=Infinity;for(const item of ITEMS.items||[])for(let tier=1;tier<=6;tier++){const p=itemPrice(item.id,tier);if(p&&Math.abs(p-target)<diff){diff=Math.abs(p-target);best={item,tier};}}if(!best)throw new Error('Не найден результат контракта.');for(const i of indices.sort((a,b)=>b-a))state.inventory.splice(i,1);const result=makeInventoryItem(best.item.id,best.tier);state.inventory.push(result);markCollection(result.id);addRating(state,5);bumpQuest(state,'contracts',1,t);return {state,result:{item:clientItem(result.id,result.tier),tier:best.tier,targetPrice:target,inputValue:total,resultPrice:itemPrice(result.id,result.tier),profit:itemPrice(result.id,result.tier)-total}};
    }
    case 'claimQuest':{
      ensureQuestState(state,t); const type=payload?.period==='weekly'?'weekly':'daily'; const defs=questDefs(state,t)[type];
      const claimed=type==='weekly'?state.weeklyQuestClaimed:state.dailyQuestClaimed, progress=type==='weekly'?state.weeklyQuestProgress:state.dailyQuestProgress;
      const id=String(payload?.id||''); const q=defs.find(x=>x.id===id); if(!q)throw new Error('Задание не найдено.');
      if(claimed.includes(id))throw new Error('Задание уже получено.'); if((progress[q.key]||0)<q.target)throw new Error('Задание ещё не выполнено.');
      claimed.push(id); addRating(state,q.rating); const reward=q.reward||{}; if(reward.coins) addCoins(state,reward.coins,t); if(reward.gems){state.gems=Math.min(1000000000,Math.floor(state.gems+reward.gems));bumpQuest(state,'gems',reward.gems,t);}if(reward.shards)state.shards=Math.min(1000000000,Math.floor(state.shards+reward.shards));return {state,result:{period:type,id,rating:q.rating,reward}};
    }
    case 'questInfo':{ensureQuestState(state,t);const p=dateKeys(t);return {state,result:{quests:questDefs(state,t),dailyProgress:state.dailyQuestProgress,weeklyProgress:state.weeklyQuestProgress,dailyClaimed:state.dailyQuestClaimed,weeklyClaimed:state.weeklyQuestClaimed,periods:{timezone:'Europe/Moscow',dailyResetAt:p.dailyResetAt,weeklyResetAt:p.weeklyResetAt}}};}
    case 'adCoins':{const day=dateKeys(t).date;if(state.adCoinsDayKey!==day){state.adCoinsDayKey=day;state.adCoinsDailyCount=0;}if(state.adCoinsDailyCount>=AD_COINS_DAILY_CAP)throw new Error('Лимит наград за рекламу на сегодня исчерпан.');if(t-state.lastAdCoinsTime<AD_COINS_COOLDOWN_MS)throw new Error(`Награда будет доступна через ${Math.ceil((AD_COINS_COOLDOWN_MS-(t-state.lastAdCoinsTime))/1000)} сек.`);state.lastAdCoinsTime=t;state.adCoinsDailyCount++;addCoins(state,AD_COINS_REWARD,t);return {state,result:{coins:AD_COINS_REWARD,dailyCount:state.adCoinsDailyCount,dailyCap:AD_COINS_DAILY_CAP}};}
    case 'dailyReward':{
      const today=dateKeys(t).date;
      if(state.dailyRewardLastClaim===today)throw new Error('Ежедневная награда уже получена сегодня.');
      const last=state.dailyRewardLastClaim;
      let day=state.dailyRewardDay||1;
      if(last){
        const lastMs=Date.parse(last+'T00:00:00Z'),todayMs=Date.parse(today+'T00:00:00Z');
        const diff=Math.floor((todayMs-lastMs)/86400000);
        if(diff===1) day=day>=DAILY_REWARDS.length?1:day+1;
        else if(diff>1) day=1;
      }
      const reward=DAILY_REWARDS.find(r=>r.day===day)||DAILY_REWARDS[0]||{day,coins:0,gems:0,items:[]};
      const coins=Math.max(0,Number(reward.coins)||0), gems=Math.max(0,Number(reward.gems)||0);
      if(coins)addCoins(state,coins,t); if(gems){state.gems+=gems;bumpQuest(state,'gems',gems,t);}
      const rewardItemCount=(reward.items||[]).reduce((n,x)=>n+Math.max(1,Math.floor(Number(x.count)||1)),0);if(state.inventory.length+rewardItemCount>MAX_INVENTORY)throw new Error(`Для награды нужно место в инвентаре: ${rewardItemCount} предмет. Освободите ячейки.`);const added=[]; for(const x of reward.items||[]){for(let i=0;i<x.count;i++){state.inventory.push(makeInventoryItem(x.itemId,x.tier));added.push({itemId:x.itemId,tier:x.tier});}}
      state.dailyRewardDay=day; state.dailyRewardLastClaim=today; addRating(state,10);
      return {state,result:{day,coins,gems,items:added,date:today}};
    }
    case 'changeNickname':{
      const nickname=String(payload?.nickname||'').trim();
      if(nickname.length<3||nickname.length>24)throw new Error('Никнейм: 3–24 символа.');
      if(!/^[A-Za-zА-Яа-яЁё0-9._×-]+$/.test(nickname))throw new Error('Никнейм: только русские/английские буквы, цифры и - . _ ×.');
      if(nickname!==state.nickname){state.nickname=nickname;state.nicknameChangeCount=Math.min(100,(state.nicknameChangeCount||0)+1);}
      return {state,result:{nickname:state.nickname,changeCount:state.nicknameChangeCount}};
    }
    case 'promo':{
      const code=String(payload?.code||'').trim().toUpperCase();
      if(!code)throw new Error('Введите промокод.');
      const promo=promoByCode.get(code); if(!promo||promo.enabled===false)throw new Error('Промокод не найден или отключён.');
      const expiryError=getPromoExpiryError(promo,now());if(expiryError)throw new Error(expiryError);
      if(state.promoUsed.includes(code))throw new Error('Этот промокод уже активирован.');
      const promoAmounts=getPromoRewardAmounts(promo);
      const coinsReward=promoAmounts.coins,gemsReward=promoAmounts.gems,shardsReward=promoAmounts.shards;
      if(state.coins+coinsReward>1000000000||state.gems+gemsReward>1000000000||state.shards+shardsReward>1000000000)throw new Error('Достигнут лимит валюты.');
      // Validate every reward before mutating the player state: a failed redemption is free to retry.
      const promoArtifacts=[];
      for(const x of Array.isArray(promo.artifacts)?promo.artifacts.slice(0,100):[]){
        const id=Math.floor(Number(x?.artifactId)),count=Math.floor(Number(x?.count));
        if(!artifactById.has(id)||!Number.isInteger(count)||count<1||count>100)throw new Error('Некорректная награда артефактов.');
        promoArtifacts.push({id,count});
      }
      const artifactRewards=new Map();
      for(const x of promoArtifacts)artifactRewards.set(x.id,(artifactRewards.get(x.id)||0)+x.count);
      if([...artifactRewards].some(([id,count])=>!canAddArtifact(state,id,count)))throw new Error('Недостаточно места для артефактов.');
      const promoItems=[]; for(const x of Array.isArray(promo.items)?promo.items.slice(0,100):[]){const id=Math.floor(Number(x?.itemId));const tier=Math.max(1,Math.min(6,Math.floor(Number(x?.tier)||1)));const count=Math.max(1,Math.min(100,Math.floor(Number(x?.count)||1)));if(!itemById.has(id)||!itemById.get(id)?.tiers?.[String(tier)])continue;promoItems.push({id,tier,count});}
      const promoItemCount=promoItems.reduce((n,x)=>n+x.count,0);
      if(state.inventory.length+promoItemCount>MAX_INVENTORY)throw new Error(`Для награды промокода нужно ${promoItemCount} свободных ячеек.`);
      if(coinsReward)addCoins(state,coinsReward,t);
      if(gemsReward){state.gems=Math.min(1000000000,state.gems+gemsReward);bumpQuest(state,'gems',gemsReward,t);}
      if(shardsReward)state.shards=Math.min(1000000000,state.shards+shardsReward);
      const added=[];for(const x of promoItems)for(let i=0;i<x.count;i++){const pi=makeInventoryItem(x.id,x.tier);state.inventory.push(pi);markCollection(pi.id);added.push({itemId:x.id,tier:x.tier});}
      for(const [id,count] of artifactRewards)addArtifact(state,id,count);
      state.promoUsed.push(code); return {state,result:{code,coins:coinsReward,gems:gemsReward,shards:shardsReward,items:added,artifacts:[...artifactRewards].map(([artifactId,count])=>({artifactId,count}))}};
    }
    case 'changePassword':{
      const current=String(payload?.currentPassword||''),next=String(payload?.newPassword||'');
      if(next.length<6||next.length>128)throw new Error('Новый пароль: 6–128 символов.');
      if(!playerRow||!verify(current,playerRow.password_salt,playerRow.password_hash))throw new Error('Текущий пароль указан неверно.');
      const salt=crypto.randomBytes(16).toString('hex');
      db.prepare('UPDATE players SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(passHash(next,salt),salt,now(),playerId);
      return {state,result:{changed:true}};
    }
    case 'settings':{const x=payload?.settings||{};state.settings.sound=x.sound!==false;if(skins.has(x.skin))state.settings.skin=x.skin;if(corners.has(x.corners))state.settings.corners=x.corners;state.settings.allowMessages=x.allowMessages!==false;return {state};}
    default:throw new Error('Неизвестное действие.');
  }
}

let cleanupAt=0;
function cleanupSessions(){
  const t=now();
  if(t<cleanupAt)return;
  cleanupAt=t+600000;
  db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(t);
  // Both maps must expire entries: otherwise unique login names accumulate indefinitely.
  for(const [key,bucket] of rate)if(t-bucket.t>120000)rate.delete(key);
  authLimiter.cleanup(t);
}
const rate=new Map();
const authIpLimit=Math.max(10,Math.min(1000,Math.floor(Number(process.env.ZOMBIX_AUTH_IP_LIMIT)||30)));
const authLimiter=createAuthRateLimiter({now,perIdentityLimit:8,perIpLimit:authIpLimit,windowMs:10*60*1000});
function authRateLimit(req,res,username=''){const ip=String(req.socket.remoteAddress||'unknown');if(!authLimiter.allow(ip,username)){err(res,429,'Слишком много попыток входа с этого адреса. Повтори позже.');return false;}return true;}
function rateLimit(req,res){const sid=cookies(req).sid;const key=sid?`session:${tokenHash(sid)}`:`ip:${String(req.socket.remoteAddress||'unknown')}`;const t=now(),bucket=rate.get(key)||{t,n:0};if(t-bucket.t>60000){bucket.t=t;bucket.n=0;}bucket.n++;rate.set(key,bucket);if(bucket.n>180){err(res,429,'Слишком много запросов за минуту для этой сессии.');return false;}return true;}

async function api(req,res,url){
 cleanupSessions();
 if(!isAllowedMutationRequest(req))return err(res,403,'Cross-site request blocked. Reload the game and try again.');
 if(req.method==='GET'&&url.pathname==='/api/health')return out(res,200,{ok:true});
 if(!rateLimit(req,res))return;
 if(req.method==='GET'&&url.pathname==='/api/public/stats'){
   const t=now(),online=Number(db.prepare('SELECT COUNT(DISTINCT player_id) c FROM player_presence WHERE last_seen_at>=?').get(t-90000)?.c||0);
   const playing=Number(db.prepare('SELECT COUNT(DISTINCT player_id) c FROM player_presence WHERE last_action_at>=?').get(t-60000)?.c||0);
   const total=Number(db.prepare('SELECT COUNT(*) c FROM players').get()?.c||0);
   const day=new Date(t).toISOString().slice(0,10);
   const dau=Number(db.prepare('SELECT COUNT(*) c FROM player_activity_daily WHERE day_utc=?').get(day)?.c||0);
   const peak=db.prepare('SELECT peak_online,peak_at FROM server_public_metrics WHERE id=1').get();
   return out(res,200,{ok:true,online,playing,totalPlayers:total,dau,peakOnline:Number(peak?.peak_online||0),updatedAt:t,windowSeconds:90},{'Cache-Control':'public, max-age=10'});
 }
 if(req.method==='POST'&&url.pathname==='/api/auth/register')return body(req).then(x=>{if(!authRateLimit(req,res,String(x.username||'')))return;
const u=String(x.username||'').trim(),p=String(x.password||'');if(!validUser(u))return err(res,400,'Логин: 3–20 символов, A-Z, 0-9 и _.');if(p.length<6||p.length>128)return err(res,400,'Пароль: 6–128 символов.');if(db.prepare('SELECT id FROM players WHERE username=?').get(u))return err(res,409,'Такой логин уже занят.');const salt=crypto.randomBytes(16).toString('hex'),ts=now(),r=db.prepare('INSERT INTO players(username,password_hash,password_salt,state_json,created_at,updated_at,last_login_at) VALUES(?,?,?,?,?,?,?)').run(u,passHash(p,salt),salt,JSON.stringify(clone(DEFAULT)),ts,ts,ts);const migrated=normalize(DEFAULT); migrated.nickname=u; commitState(Number(r.lastInsertRowid),migrated,0); session(res,Number(r.lastInsertRowid)); return out(res,201,{ok:true,username:u,nickname:u});}).catch(e=>err(res,400,e.message));
 if(req.method==='POST'&&url.pathname==='/api/auth/login')return body(req).then(x=>{if(!authRateLimit(req,res,String(x.username||'')))return;
const u=String(x.username||'').trim(),p=String(x.password||''),r=db.prepare('SELECT * FROM players WHERE username=?').get(u);if(!r||!verify(p,r.password_salt,r.password_hash))return err(res,401,'Неверный логин или пароль.');const ts=now();db.prepare('UPDATE players SET last_login_at=?,updated_at=? WHERE id=?').run(ts,ts,r.id);session(res,r.id);const st=normalize(JSON.parse(r.state_json)); if(!st.nickname){st.nickname=r.username;commitState(r.id,st,r.state_version);} return out(res,200,{ok:true,username:r.username,nickname:st.nickname});}).catch(e=>err(res,400,e.message));
 if(req.method==='POST'&&url.pathname==='/api/auth/change-password')return body(req).then(x=>{const sid=cookies(req).sid;const p=getSession(req);if(!p||!sid)return err(res,401,'Требуется авторизация.');const current=String(x.currentPassword||''),next=String(x.newPassword||'');if(next.length<6||next.length>128)return err(res,400,'Новый пароль: 6–128 символов.');if(!verify(current,p.password_salt,p.password_hash))return err(res,400,'Текущий пароль указан неверно.');const salt=crypto.randomBytes(16).toString('hex');db.prepare('UPDATE players SET password_hash=?,password_salt=?,updated_at=? WHERE id=?').run(passHash(next,salt),salt,now(),p.id);db.prepare('DELETE FROM sessions WHERE player_id=?').run(p.id);return out(res,200,{ok:true});}).catch(e=>err(res,400,e.message));
 if(req.method==='POST'&&url.pathname==='/api/auth/logout'){const sid=cookies(req).sid;if(sid)db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(sid));res.setHeader('Set-Cookie',`sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${COOKIE_SECURE?'; Secure':''}`);return out(res,200,{ok:true});}
 const p=getSession(req);if(!p)return err(res,401,'Требуется авторизация.');
 if(req.method==='POST'&&url.pathname==='/api/presence'){
   const sid=cookies(req).sid,hash=tokenHash(sid),t=now();
   const existing=db.prepare('SELECT last_seen_at FROM player_presence WHERE session_hash=?').get(hash);
   if(!existing||t-Number(existing.last_seen_at)>=30000){
     db.prepare(`INSERT INTO player_presence(session_hash,player_id,last_seen_at,last_action_at,client_kind) VALUES(?,?,?,0,'web')
       ON CONFLICT(session_hash) DO UPDATE SET player_id=excluded.player_id,last_seen_at=excluded.last_seen_at`).run(hash,p.id,t);
     const online=Number(db.prepare('SELECT COUNT(DISTINCT player_id) c FROM player_presence WHERE last_seen_at>=?').get(t-90000)?.c||0);
     db.prepare('UPDATE server_public_metrics SET peak_online=MAX(peak_online,?),peak_at=CASE WHEN ?>peak_online THEN ? ELSE peak_at END,updated_at=? WHERE id=1').run(online,online,t,t);
   }
   return out(res,200,{ok:true,serverTime:t});
 }
 if(req.method==='GET'&&url.pathname==='/api/me'){
   const state=normalize(JSON.parse(p.state_json));
   if(!state.nickname)state.nickname=p.username;
   const projected=publicState(p.id,state);
   return out(res,200,{ok:true,username:p.username,nickname:state.nickname,state:projected});
 }
 if(req.method==='GET'&&url.pathname==='/api/inventory'){
   const exists=db.prepare('SELECT 1 FROM players WHERE id=?').get(p.id);
   if(!exists)return err(res,404,'Игрок не найден.');
   const result=queryProjectedInventory(db,p.id,itemById,{
     page:url.searchParams.get('page'), pageSize:url.searchParams.get('limit'),
     query:url.searchParams.get('q'), tier:url.searchParams.get('tier'), sort:url.searchParams.get('sort')
   });
   return out(res,200,{ok:true,...result});
 }
 if(req.method==='GET'&&url.pathname==='/api/wallet/history'){
   const limit=Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get('limit'))||20)));
   const before=Math.max(0,Math.floor(Number(url.searchParams.get('before'))||0));
   const rows=before
     ?db.prepare('SELECT id,currency,delta,balance_after,reason,created_at FROM wallet_ledger WHERE player_id=? AND id<? ORDER BY id DESC LIMIT ?').all(p.id,before,limit+1)
     :db.prepare('SELECT id,currency,delta,balance_after,reason,created_at FROM wallet_ledger WHERE player_id=? ORDER BY id DESC LIMIT ?').all(p.id,limit+1);
   const hasMore=rows.length>limit,visible=rows.slice(0,limit);
   return out(res,200,{ok:true,entries:visible.map(row=>({id:Number(row.id),currency:row.currency,delta:Number(row.delta),balanceAfter:Number(row.balance_after),reason:row.reason,createdAt:Number(row.created_at)})),nextCursor:hasMore?Number(visible[visible.length-1]?.id)||null:null});
 }
 if(req.method==='POST'&&url.pathname==='/api/progression/claim')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
   const achievementId=String(x.achievementId||'');
   const definition=ACHIEVEMENTS.find(item=>item.id===achievementId);
   if(!definition)throw new Error('Достижение не найдено.');
   const request=createPlayerActionRequestContext(p.id,x.idempotencyKey,'achievement_claim',{achievementId});
   if(replayPlayerActionRequest(res,request))return;
   db.exec('BEGIN IMMEDIATE');try{
     const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(p.id);
     const state=normalize(JSON.parse(row.state_json));
     const progression=buildProgressionData(p.id,state);
     const achievement=progression.achievements.find(item=>item.id===achievementId);
     if(!achievement?.completed)throw new Error('Условие достижения ещё не выполнено.');
     const already=db.prepare('SELECT 1 FROM player_achievement_claims WHERE player_id=? AND achievement_id=?').get(p.id,achievementId);
     if(already)throw new Error('Награда за это достижение уже получена.');
     const reward=definition.reward;
     if(state.coins+reward.coins>1000000000||state.gems+reward.gems>1000000000||state.shards+reward.shards>1000000000)throw new Error('Достигнут лимит валюты.');
     addCoins(state,reward.coins);state.gems+=reward.gems;state.shards+=reward.shards;
     const saved=commitState(p.id,state,row.state_version,{reason:'achievement_reward',operationId:request?.id||null});
     const claimedAt=now();
     db.prepare('INSERT INTO player_achievement_claims(player_id,achievement_id,reward_coins,reward_gems,reward_shards,claimed_at) VALUES(?,?,?,?,?,?)').run(p.id,achievementId,reward.coins,reward.gems,reward.shards,claimedAt);
     const result={achievementId,reward,claimedAt};savePlayerActionRequest(request,result);db.exec('COMMIT');
     return out(res,200,{ok:true,state:saved,...result});
   }catch(error){db.exec('ROLLBACK');throw error;}
 })).catch(error=>err(res,400,error.message));
 if(req.method==='GET'&&url.pathname==='/api/progression'){
   const state=publicState(p.id,normalize(JSON.parse(p.state_json)));
   return out(res,200,buildProgressionData(p.id,state));
 }

 function marketRecordHistory(artifactId,price,kind,operationId=null){
   const quantity=Number(marketDb.prepare("SELECT COUNT(*) c FROM orders WHERE artifact_id=? AND status='active' AND currency='shards'").get(Number(artifactId))?.c||0);
   const ts=Date.now();
   if(operationId&&marketDb.prepare('SELECT id FROM market_history WHERE operation_id=?').get(String(operationId)))return;
   marketDb.prepare('INSERT INTO market_history(artifact_id,price_gems,quantity,kind,recorded_at,operation_id) VALUES(?,?,?,?,?,?)').run(Number(artifactId),Math.max(0,Math.floor(Number(price)||0)),quantity,String(kind||'snapshot'),ts,operationId?String(operationId):null);
 }
 function cleanupOrphanMarketOrders(){
   const rows=marketDb.prepare("SELECT id,seller_id FROM orders WHERE status='active' LIMIT 500").all();const t=now();
   for(const row of rows){if(!db.prepare('SELECT id FROM players WHERE id=?').get(Number(row.seller_id)))marketDb.prepare("UPDATE orders SET status='cancelled',cancelled_at=? WHERE id=? AND status='active'").run(t,Number(row.id));}
   // History retention is not needed for the live order-book chart; avoid periodic full-table pruning.
 }
 if(now()>=marketCleanupAt){marketCleanupAt=now()+5*60*1000;cleanupOrphanMarketOrders();}
 if(url.pathname==='/api/case-history'&&req.method==='GET'){
   const limit=Math.min(10,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||10)));
   // The visible history is deliberately restricted to the latest ten sessions.
   // Older opening records remain untouched in SQLite for economy audit/support.
   const rows=db.prepare('SELECT * FROM case_openings WHERE player_id=? ORDER BY id DESC LIMIT ?').all(p.id,limit);
   const stats=db.prepare('SELECT openings,cases FROM player_case_stats WHERE player_id=?').get(p.id)||{};
   const entries=rows.map(row=>{
     const stored=JSON.parse(row.results_json),rewards=Array.isArray(stored.items)?stored.items:[{item:stored.item,tier:stored.tier}];
     return {id:Number(row.id),caseId:Number(row.case_id),quantity:Number(row.quantity),createdAt:Number(row.created_at)||0,result:{items:rewards.slice(0,10).map(reward=>{const item=reward?.item||{};return {tier:Number(reward?.tier)||1,item:{id:Number(item.id)||0,name:String(item.name||''),image:String(item.image||'')}};})}};
   });
   return out(res,200,{ok:true,entries,nextCursor:null,stats:{openings:Number(stats.openings||0),cases:Number(stats.cases||0)}});
 }
 if(url.pathname==='/api/plane'&&req.method==='GET'){
  const r=planeTick(),mine=db.prepare('SELECT coins FROM cargo_contributions WHERE flight_id=? AND player_id=?').get(r.id,p.id);const totals=db.prepare('SELECT COALESCE(SUM(coins),0) coins, COUNT(*) players FROM cargo_contributions WHERE flight_id=?').get(r.id);const leaders=db.prepare('SELECT c.player_id id,c.coins,p.state_json FROM cargo_contributions c JOIN players p ON p.id=c.player_id WHERE c.flight_id=? ORDER BY c.coins DESC,c.player_id ASC LIMIT 10').all(r.id).map(({id,coins,state_json})=>({id,coins,nickname:normalize(JSON.parse(state_json)).nickname||`ИГРОК #${id}`,avatar:normalize(JSON.parse(state_json)).selectedAvatar||1}));const myRewards=db.prepare('SELECT COUNT(*) total,SUM(CASE WHEN mail_id IS NOT NULL THEN 1 ELSE 0 END) delivered FROM cargo_rewards WHERE flight_id=? AND player_id=?').get(r.id,p.id);
  return out(res,200,{ok:true,flight:r,phase:planePhase(r),myCoins:mine?.coins||0,totals,rewards:{total:myRewards?.total||0,delivered:myRewards?.delivered||0},slotCost:PLANE_SLOT,cargoPlaces:Math.floor(totals.coins/PLANE_SLOT),weight:planeWeight(mine?.coins||0),leaders,serverTime:now()});
 }
 if(url.pathname==='/api/plane/contribute'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
  const amount=Number(x.coins);if(!Number.isSafeInteger(amount)||amount<1||amount>100000000)throw new Error('Укажите сумму от 1 до 100 000 000 монет.');
  const request=createPlayerActionRequestContext(p.id,x.idempotencyKey,'plane_contribute',{coins:amount});
  if(replayPlayerActionRequest(res,request))return;
  const r=planeTick();if(planePhase(r)!=='prep')throw new Error('Подготовка завершена. Дождитесь следующего рейса.');
  db.exec('BEGIN IMMEDIATE');try{
    const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(p.id),state=normalize(JSON.parse(row.state_json));if(state.coins<amount)throw new Error('Недостаточно монет.');
    state.coins-=amount;const saved=commitState(p.id,state,row.state_version,{reason:'cargo_contribution',operationId:request?.id||null});
    db.prepare('INSERT INTO cargo_contributions(flight_id,player_id,coins) VALUES(?,?,?) ON CONFLICT(flight_id,player_id) DO UPDATE SET coins=coins+excluded.coins').run(r.id,p.id,amount);
    savePlayerActionRequest(request,{flightId:Number(r.id),coins:amount});db.exec('COMMIT');return out(res,200,{ok:true,state:saved,flightId:Number(r.id),coins:amount});
  }catch(e){db.exec('ROLLBACK');throw e;}
 })).catch(e=>err(res,400,e.message));
 if(url.pathname==='/api/player/preview'&&req.method==='GET'){
   const id=Number(url.searchParams.get('id'));
   if(!Number.isSafeInteger(id)||id<1)return err(res,400,'Некорректный ID игрока.');
   const row=db.prepare('SELECT id,username,state_json,created_at FROM players WHERE id=?').get(id);
   if(!row)return err(res,404,'Игрок не найден.');
   const state=normalize(JSON.parse(row.state_json));
   return out(res,200,{ok:true,player:{id:row.id,username:state.nickname||row.username,level:state.level,avatar:state.selectedAvatar,days:Math.max(1,Math.floor((now()-row.created_at)/86400000)+1),allowMessages:state.settings.allowMessages!==false,isMe:id===p.id}});
 }
 if(url.pathname==='/api/mail/send'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
   const receiver=Number(x.playerId),message=String(x.message||'').trim();
   if(!Number.isSafeInteger(receiver)||receiver<1||receiver===p.id)throw new Error('Нельзя отправить сообщение этому игроку.');
   if(message.length<1||message.length>300||!/^[A-Za-zА-Яа-яЁё., ]+$/u.test(message))throw new Error('Только русские и английские буквы, пробел, запятая и точка (до 300 символов).');
   const request=createPlayerActionRequestContext(p.id,x.idempotencyKey,'mail_send',{playerId:receiver,message});
   if(replayPlayerActionRequest(res,request))return;
   const t=now(); db.exec('BEGIN IMMEDIATE');
   try{
     const target=db.prepare('SELECT id,state_json FROM players WHERE id=?').get(receiver);if(!target)throw new Error('Получатель не найден.');if(normalize(JSON.parse(target.state_json)).settings.allowMessages===false)throw new Error('Этот игрок запретил личные сообщения.');
     const latest=db.prepare("SELECT created_at FROM player_mail WHERE sender_id=? AND kind='dm' ORDER BY created_at DESC LIMIT 1").get(p.id);
     if(latest&&t-latest.created_at<10000)throw new Error('Следующее сообщение можно отправить через 10 секунд.');
     const row=db.prepare('SELECT state_json,state_version,username FROM players WHERE id=?').get(p.id),state=normalize(JSON.parse(row.state_json));
     if(state.gems<1)throw new Error('Для отправки нужен 1 гем.');
     state.gems-=1;
     const messageInsert=db.prepare('INSERT INTO player_mail(player_id,operation_id,kind,sender_id,sender_name,message_text,created_at,expires_at,claimed_at) VALUES(?,?,?,?,?,?,?,?,?)').run(receiver,`dm:${p.id}:${request?.id||crypto.randomUUID()}`,'dm',p.id,state.nickname||row.username,message,t,t+MAIL_LIFETIME,t);
     const saved=commitState(p.id,state,row.state_version,{reason:'message_send',operationId:request?.id||null});
     const result={messageId:Number(messageInsert.lastInsertRowid)};savePlayerActionRequest(request,result);
     db.exec('COMMIT');return out(res,200,{ok:true,state:saved,...result});
   }catch(e){db.exec('ROLLBACK');throw e;}
 })).catch(e=>err(res,400,e.message));
 if(url.pathname==='/api/mail/status'&&req.method==='GET'){planeTick();
   settleExpiredMail();
   const row=db.prepare("SELECT EXISTS(SELECT 1 FROM player_mail WHERE player_id=? AND (claimed_at IS NULL OR (kind='dm' AND read_at IS NULL)) AND expires_at>?) AS unclaimed").get(p.id,now());
   return out(res,200,{ok:true,unclaimed:!!row.unclaimed});
 }
 if(url.pathname==='/api/mail'&&req.method==='GET'){planeTick();
   settleExpiredMail();
   const before=Math.max(0,Math.floor(Number(url.searchParams.get('before'))||0)),pageSize=120;
   const messages=db.prepare(`SELECT m.id,m.kind,m.artifact_id,m.gross_gems,m.fee_gems,m.reward_gems,m.reward_shards,m.artifact_qty,m.created_at,m.expires_at,m.claimed_at,m.read_at,m.sender_id,m.sender_name,m.message_text,c.flight_id,co.coins AS flight_coins FROM player_mail m LEFT JOIN cargo_rewards c ON c.mail_id=m.id LEFT JOIN cargo_contributions co ON co.flight_id=c.flight_id AND co.player_id=m.player_id WHERE m.player_id=? AND m.archived_at IS NULL AND (?=0 OR m.id<?) ORDER BY m.id DESC LIMIT ?`).all(p.id,before,before,pageSize+1);
   const more=messages.length>pageSize;if(more)messages.pop();const pending=db.prepare("SELECT EXISTS(SELECT 1 FROM player_mail WHERE player_id=? AND archived_at IS NULL AND expires_at>? AND (claimed_at IS NULL OR (kind='dm' AND read_at IS NULL))) n").get(p.id,now());return out(res,200,{ok:true,messages,nextCursor:more?messages[messages.length-1].id:null,unclaimed:Number(pending.n)});
 }
 if(url.pathname==='/api/mail/read'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{const ids=Array.isArray(x.ids)?x.ids.filter(v=>Number.isSafeInteger(v)&&v>0).slice(0,300):[];if(x.all===true){db.prepare('UPDATE player_mail SET read_at=? WHERE player_id=? AND read_at IS NULL').run(now(),p.id);}else{const mark=db.prepare('UPDATE player_mail SET read_at=? WHERE player_id=? AND id=? AND read_at IS NULL');db.exec('BEGIN IMMEDIATE');try{for(const id of ids)mark.run(now(),p.id,id);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}return out(res,200,{ok:true});})).catch(e=>err(res,400,e.message));
 if(url.pathname==='/api/mail/archive-read'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{const t=now();const result=db.prepare('UPDATE player_mail SET archived_at=? WHERE player_id=? AND read_at IS NOT NULL AND claimed_at IS NOT NULL AND archived_at IS NULL').run(t,p.id);return out(res,200,{ok:true,archived:result.changes});})).catch(e=>err(res,400,e.message));
 if(url.pathname==='/api/mail/claim-flight'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
  const flightId=Number(x.flightId);if(!Number.isSafeInteger(flightId)||flightId<1)return err(res,400,'Неверный рейс.');
  db.exec('BEGIN IMMEDIATE');try{
   const mails=db.prepare(`SELECT m.* FROM player_mail m JOIN cargo_rewards c ON c.mail_id=m.id WHERE m.player_id=? AND c.flight_id=? AND m.claimed_at IS NULL AND m.expires_at>? ORDER BY m.id`).all(p.id,flightId,now());
   if(!mails.length){db.exec('COMMIT');return err(res,400,'Неполученного груза нет.');}
   const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(p.id),state=normalize(JSON.parse(row.state_json));let gained=0,shards=0;
   for(const m of mails){if(m.kind==='plane_artifact'){if(!canAddArtifact(state,m.artifact_id,Number(m.artifact_qty||1)))throw new Error('Достигнут безопасный лимит этого артефакта.');addArtifact(state,m.artifact_id,Number(m.artifact_qty||1));gained+=Number(m.artifact_qty||1);}else{shards+=Number(m.reward_shards||0);if(state.shards+Number(m.reward_shards||0)>1000000000)throw new Error('Достигнут лимит осколков.');state.shards+=Number(m.reward_shards||0);}db.prepare('UPDATE player_mail SET claimed_at=?,read_at=COALESCE(read_at,?) WHERE id=? AND claimed_at IS NULL').run(now(),now(),m.id);}
   const result=commitState(p.id,state,row.state_version,{reason:'plane_reward'});db.exec('COMMIT');return out(res,200,{ok:true,state:result,gained,shards});
  }catch(e){db.exec('ROLLBACK');return err(res,400,e.message);}
 })).catch(e=>err(res,400,e.message));
 if(url.pathname==='/api/mail/claim'&&req.method==='POST')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
   settleExpiredMail();const id=Math.floor(Number(x.id));if(!Number.isSafeInteger(id)||id<1)return err(res,400,'Письмо не найдено.');
   db.exec('BEGIN IMMEDIATE');try{
     const m=db.prepare('SELECT * FROM player_mail WHERE id=? AND player_id=? AND claimed_at IS NULL AND expires_at>?').get(id,p.id,now());
     if(!m)throw new Error('Награда уже получена или письмо удалено.');
     const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(p.id),state=normalize(JSON.parse(row.state_json));
     if(m.kind==='plane_artifact'){if(!canAddArtifact(state,m.artifact_id,Number(m.artifact_qty||1)))throw new Error('Достигнут безопасный лимит этого артефакта.');addArtifact(state,m.artifact_id,Number(m.artifact_qty||1));}else{if(state.gems+m.reward_gems>1000000000||state.shards+Number(m.reward_shards||0)>1000000000)throw new Error('Достигнут лимит валюты.');state.gems+=m.reward_gems;state.shards+=Number(m.reward_shards||0);}const updated=db.prepare('UPDATE player_mail SET claimed_at=?,read_at=COALESCE(read_at,?) WHERE id=? AND claimed_at IS NULL').run(now(),now(),id);
     if(!updated.changes)throw new Error('Награда уже получена.');
     const result=commitState(p.id,state,row.state_version,{reason:'mail_claim',operationId:m.operation_id||null});db.exec('COMMIT');return out(res,200,{ok:true,state:result,reward:m.kind==='plane_artifact'?1:(m.reward_shards||m.reward_gems),kind:m.kind});
   }catch(e){db.exec('ROLLBACK');return err(res,400,e.message);}
 })).catch(e=>err(res,400,e.message));
 if(req.method==='GET'&&url.pathname==='/api/artifacts/quote'){
  const aid=Number(url.searchParams.get('artifact'));if(!Number.isSafeInteger(aid)||!artifactById.has(aid))return err(res,400,'Неизвестный артефакт.');
  const r=marketDb.prepare("SELECT MIN(price_gems) minPrice,COUNT(*) count FROM orders WHERE artifact_id=? AND status='active' AND currency='shards'").get(aid);
  return out(res,200,{ok:true,minPrice:Number(r?.minPrice)||0,count:Number(r?.count)||0});
 }
 if(req.method==='POST'&&url.pathname==='/api/artifacts/recycle')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
  const aid=Number(x.artifactId),qty=Number(x.quantity||1);if(!Number.isSafeInteger(aid)||!artifactById.has(aid)||!Number.isSafeInteger(qty)||qty<1||qty>50)throw new Error('Некорректное количество.');
  const request=createPlayerActionRequestContext(p.id,x.idempotencyKey,'artifact_recycle',{artifactId:aid,quantity:qty});
  if(replayPlayerActionRequest(res,request))return;
  db.exec('BEGIN IMMEDIATE');try{
    const row=db.prepare('SELECT state_json,state_version FROM players WHERE id=?').get(p.id),st=normalize(JSON.parse(row.state_json));if(artifactCount(st,aid)<qty)throw new Error('Недостаточно артефактов.');
    const unit=artifactRecycleValue(aid),reward=unit*qty;if(st.shards+reward>1000000000)throw new Error('Достигнут лимит осколков.');removeArtifact(st,aid,qty);st.shards+=reward;
    const saved=commitState(p.id,st,row.state_version,{reason:'artifact_recycle',operationId:request?.id||null});
    const result={reward,unit};savePlayerActionRequest(request,result);db.exec('COMMIT');return out(res,200,{ok:true,state:saved,...result});
  }catch(e){db.exec('ROLLBACK');throw e;}
 })).catch(e=>err(res,400,e.message));
 if(req.method==='GET'&&url.pathname==='/api/market'){
   const aid=Math.floor(Number(url.searchParams.get('artifact'))||0),limit=Math.min(120,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||80)));
   const where=aid&&artifactById.has(aid)?' AND artifact_id=?':'';const params=aid&&artifactById.has(aid)?[aid,limit]:[limit];
   // market.sqlite is intentionally independent from game.sqlite, so player data is resolved separately.
   const rows=marketDb.prepare(`SELECT id,artifact_id,price_gems,created_at,seller_id,currency FROM orders WHERE status='active' AND currency='shards'${where} ORDER BY price_gems ASC,created_at ASC,id ASC LIMIT ?`).all(...params);
   const mine=marketDb.prepare("SELECT id,artifact_id,price_gems,created_at,seller_id,currency FROM orders WHERE status='active' AND seller_id=? ORDER BY created_at DESC LIMIT 500").all(p.id);
   // At least one purchasable quote for every artifact, even when the first 120 lots belong to another artifact or to the viewer.
   const quoteStmt=marketDb.prepare("SELECT id,artifact_id,price_gems,created_at,seller_id,currency FROM orders WHERE status='active' AND currency='shards' AND artifact_id=? AND seller_id<>? ORDER BY price_gems ASC,created_at ASC,id ASC LIMIT 1");
   const quotes=(aid&&artifactById.has(aid)?[aid]:ARTIFACTS_DATA.artifacts.map(a=>Number(a.id))).map(id=>quoteStmt.get(id,p.id)).filter(Boolean);
   const allRows=new Map([...rows,...mine,...quotes].map(r=>[Number(r.id),r]));
   const statsRows=marketDb.prepare('SELECT * FROM market_stats').all();
   const stats={};for(const r of statsRows)stats[r.artifact_id]={min:Number(r.min_price)||0,max:Number(r.max_price)||0,avg:r.sales?Math.round(Number(r.total_price)/Number(r.sales)):0,sales:Number(r.sales)||0};
   const bookRows=marketDb.prepare("SELECT artifact_id,COUNT(*) lotCount,MIN(price_gems) minPrice,MAX(created_at) newest FROM orders WHERE status='active' AND currency='shards' GROUP BY artifact_id").all();
   const book={};for(const r of bookRows)book[r.artifact_id]={count:Number(r.lotCount),minPrice:Number(r.minPrice),newest:Number(r.newest)};
   // One grouped scan for price distribution; no sale-history scan on catalog requests.
   const depthRows=aid&&artifactById.has(aid)?marketDb.prepare("SELECT artifact_id,price_gems price,COUNT(*) quantity FROM orders WHERE status='active' AND currency='shards' AND artifact_id=? GROUP BY artifact_id,price_gems ORDER BY price_gems LIMIT 60").all(aid):[];
   const depth={};for(const r of depthRows)(depth[r.artifact_id]||(depth[r.artifact_id]=[])).push({price:Number(r.price),quantity:Number(r.quantity)});
   const historyRows=aid&&artifactById.has(aid)?marketDb.prepare("SELECT id,price_gems,quantity,recorded_at FROM market_history WHERE artifact_id=? AND kind='sale' ORDER BY recorded_at DESC,id DESC LIMIT 30").all(aid):[];
   const history=aid&&artifactById.has(aid)?{[aid]:historyRows.map(r=>({id:Number(r.id),price:Number(r.price_gems),quantity:Number(r.quantity),recordedAt:Number(r.recorded_at)}))}:{};
   return out(res,200,{ok:true,listings:[...allRows.values()].map(r=>({id:Number(r.id),artifactId:Number(r.artifact_id),price:Number(r.price_gems),createdAt:Number(r.created_at),sellerId:Number(r.seller_id),isMine:Number(r.seller_id)===Number(p.id),currency:r.currency||'gems'})),stats,history,book,depth,artifacts:ARTIFACTS_DATA.artifacts});
 }
 if(req.method==='POST'&&url.pathname==='/api/market/action')return body(req).then(x=>withMarketActionLock(async()=>{
   let opId=null, dbCommitted=false, marketCommitted=false;
   try{
     const type=String(x.action||''),payload=x.payload||{},pid=p.id,t=now();
     const marketRequestId=String(x.idempotencyKey||'').trim();
     if(marketRequestId&&!/^[A-Za-z0-9._:-]{8,128}$/.test(marketRequestId))throw new Error('Некорректный ключ операции рынка.');
     const marketActionType=`market:${type}`;
     const marketPayloadHash=crypto.createHash('sha256').update(JSON.stringify({action:type,payload})).digest('hex');
     if(marketRequestId){
       const prior=db.prepare('SELECT action_type,payload_hash,result_json FROM player_action_requests WHERE player_id=? AND request_id=?').get(pid,marketRequestId);
       if(prior){
         if(prior.action_type!==marketActionType||prior.payload_hash!==marketPayloadHash)throw new Error('Ключ уже использован для другой операции рынка.');
         const row=db.prepare('SELECT state_json FROM players WHERE id=?').get(pid);if(!row)throw new Error('Игрок не найден.');
         return out(res,200,{ok:true,state:publicState(pid,normalize(JSON.parse(row.state_json))),result:JSON.parse(prior.result_json||'null'),replayed:true});
       }
     }
     const storeMarketReceipt=result=>{if(marketRequestId)db.prepare('INSERT INTO player_action_requests(player_id,request_id,action_type,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?)').run(pid,marketRequestId,marketActionType,marketPayloadHash,JSON.stringify(result),t);};
     if(type==='list'){
       const aid=Math.floor(Number(payload.artifactId)),price=Math.floor(Number(payload.price));
       if(!artifactById.has(aid))throw new Error('Артефакт не найден.');if(price<1||price>1000000)throw new Error('Цена: 1–1 000 000 осколков.');
       const row=db.prepare('SELECT * FROM players WHERE id=?').get(pid);if(!row)throw new Error('Игрок не найден.');
       const before=normalize(JSON.parse(row.state_json));const st=clone(before);if(artifactCount(st,aid)<1)throw new Error('У вас нет этого артефакта.');removeArtifact(st,aid,1);const after=normalize(st);
       opId=beginStateOperation('market',pid,{operationId:null,atomicDb:true,marketExpected:true,playerIds:[pid],beforeStates:[{playerId:pid,state:before}],afterStates:[{playerId:pid,state:after}],kind:'list',artifactId:aid,price});
       db.prepare('UPDATE state_operations SET payload_json=?,updated_at=? WHERE op_id=?').run(JSON.stringify({operationId:opId,atomicDb:true,marketExpected:true,playerIds:[pid],beforeStates:[{playerId:pid,state:before}],afterStates:[{playerId:pid,state:after}],kind:'list',artifactId:aid,price}),now(),opId);
       db.exec('BEGIN IMMEDIATE');
       const ins=marketDb.prepare(`INSERT INTO orders(seller_id,artifact_id,price_gems,created_at,status,operation_id,currency) VALUES(?,?,?,?,'active',?,'shards')`).run(pid,aid,price,t,opId);marketRecordHistory(aid,price,'list',opId);
       persistPlayerStateRow(pid,after,row.state_version,t,{reason:'market_list',operationId:opId});
       const marketResult={listingId:Number(ins.lastInsertRowid),artifactId:aid,price};
       storeMarketReceipt(marketResult);
       recordPlayerActivity(p.id,tokenHash(cookies(req).sid));finishStateOperation(opId);db.exec('COMMIT');dbCommitted=true;marketCommitted=true;
       return out(res,200,{ok:true,state:publicState(pid,after),result:marketResult});
     }
     if(type==='buy'||type==='buy_cheapest'){
       let lid,listing;
       if(type==='buy_cheapest'){
         const aid=Math.floor(Number(payload.artifactId));if(!artifactById.has(aid))throw new Error('Артефакт не найден.');
         // Selection is server-side under the global market lock. Do not trust a stale client quote.
         listing=marketDb.prepare(`SELECT * FROM orders WHERE artifact_id=? AND status='active' AND seller_id<>? AND currency='shards' ORDER BY price_gems ASC,created_at ASC,id ASC LIMIT 1`).get(aid,pid);
         if(!listing)throw new Error('Доступных лотов больше нет.');lid=Number(listing.id);
       }else{
         lid=Math.floor(Number(payload.listingId));if(!lid)throw new Error('Лот не найден.');
         listing=marketDb.prepare(`SELECT * FROM orders WHERE id=? AND status='active'`).get(lid);if(!listing)throw new Error('Лот уже продан или снят.');
       }
       if(Number(listing.seller_id)===pid)throw new Error('Нельзя купить свой лот.');
       const buyerRow=db.prepare('SELECT * FROM players WHERE id=?').get(pid),sellerRow=db.prepare('SELECT * FROM players WHERE id=?').get(listing.seller_id);if(!buyerRow||!sellerRow)throw new Error('Игрок не найден.');
       const buyerBefore=normalize(JSON.parse(buyerRow.state_json)),sellerBefore=normalize(JSON.parse(sellerRow.state_json));const buyer=clone(buyerBefore),seller=clone(sellerBefore);const price=Math.max(1,Number(listing.price_gems)||0);
       if((listing.currency==='shards'?buyer.shards:buyer.gems)<price)throw new Error(listing.currency==='shards'?'Недостаточно осколков.':'Недостаточно гемов.');if(!canAddArtifact(buyer,Number(listing.artifact_id),1))throw new Error('Достигнут безопасный лимит этого артефакта.');
       if(listing.currency==='shards')buyer.shards-=price;else buyer.gems-=price;const fee=Math.floor(price/20),net=price-fee;addArtifact(buyer,Number(listing.artifact_id),1);
       opId=beginStateOperation('market',pid,{operationId:null,atomicDb:true,marketExpected:true,playerIds:[pid,Number(listing.seller_id)],beforeStates:[{playerId:pid,state:buyerBefore},{playerId:Number(listing.seller_id),state:sellerBefore}],afterStates:[{playerId:pid,state:buyer},{playerId:Number(listing.seller_id),state:seller}],kind:'buy',artifactId:Number(listing.artifact_id),price,listingId:lid});
       db.prepare('UPDATE state_operations SET payload_json=?,updated_at=? WHERE op_id=?').run(JSON.stringify({operationId:opId,atomicDb:true,marketExpected:true,playerIds:[pid,Number(listing.seller_id)],beforeStates:[{playerId:pid,state:buyerBefore},{playerId:Number(listing.seller_id),state:sellerBefore}],afterStates:[{playerId:pid,state:buyer},{playerId:Number(listing.seller_id),state:seller}],kind:'buy',artifactId:Number(listing.artifact_id),price,listingId:lid}),now(),opId);
       db.exec('BEGIN IMMEDIATE');
       const upd=marketDb.prepare(`UPDATE orders SET status='sold',buyer_id=?,sold_at=? WHERE id=? AND status='active'`).run(pid,t,lid);if(!upd.changes)throw new Error('Лот уже куплен другим игроком.');marketRecordHistory(Number(listing.artifact_id),price,'sale',opId);
       persistPlayerStateRow(Number(listing.seller_id),seller,sellerRow.state_version,t,{reason:'market_sale_credit',operationId:opId});
       persistPlayerStateRow(pid,buyer,buyerRow.state_version,t,{reason:'market_purchase',operationId:opId});
       db.prepare('INSERT INTO player_mail(player_id,operation_id,kind,artifact_id,gross_gems,fee_gems,reward_gems,reward_shards,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(Number(listing.seller_id),opId,listing.currency==='shards'?'market_shards':'market_sale',Number(listing.artifact_id),price,fee,listing.currency==='shards'?0:net,listing.currency==='shards'?net:0,t,t+MAIL_LIFETIME);
       const marketResult={listingId:lid,artifactId:Number(listing.artifact_id),price};
       storeMarketReceipt(marketResult);
       recordPlayerActivity(p.id,tokenHash(cookies(req).sid));finishStateOperation(opId);db.exec('COMMIT');dbCommitted=true;marketCommitted=true;
       return out(res,200,{ok:true,state:publicState(pid,buyer),result:marketResult});
     }
     if(type==='cancel'){
       const lid=Math.floor(Number(payload.listingId));if(!lid)throw new Error('Лот не найден.');
       const listing=marketDb.prepare(`SELECT * FROM orders WHERE id=? AND status='active'`).get(lid);if(!listing)throw new Error('Лот уже снят.');if(Number(listing.seller_id)!==pid)throw new Error('Это не ваш лот.');
       const row=db.prepare('SELECT * FROM players WHERE id=?').get(pid);if(!row)throw new Error('Игрок не найден.');const before=normalize(JSON.parse(row.state_json));const st=clone(before);if(!canAddArtifact(st,Number(listing.artifact_id),1))throw new Error('Достигнут безопасный лимит этого артефакта.');addArtifact(st,Number(listing.artifact_id),1);
       opId=beginStateOperation('market',pid,{operationId:null,atomicDb:true,marketExpected:true,playerIds:[pid],beforeStates:[{playerId:pid,state:before}],afterStates:[{playerId:pid,state:st}],kind:'cancel',artifactId:Number(listing.artifact_id),price:Number(listing.price_gems),listingId:lid});
       db.prepare('UPDATE state_operations SET payload_json=?,updated_at=? WHERE op_id=?').run(JSON.stringify({operationId:opId,atomicDb:true,marketExpected:true,playerIds:[pid],beforeStates:[{playerId:pid,state:before}],afterStates:[{playerId:pid,state:st}],kind:'cancel',artifactId:Number(listing.artifact_id),price:Number(listing.price_gems),listingId:lid}),now(),opId);
       db.exec('BEGIN IMMEDIATE');
       const upd=marketDb.prepare(`UPDATE orders SET status='cancelled',cancelled_at=? WHERE id=? AND status='active'`).run(t,lid);if(!upd.changes)throw new Error('Лот уже снят.');marketRecordHistory(Number(listing.artifact_id),Number(listing.price_gems),'cancel',opId);
       persistPlayerStateRow(pid,st,row.state_version,t,{reason:'market_cancel',operationId:opId});
       const marketResult={listingId:lid,artifactId:Number(listing.artifact_id)};
       storeMarketReceipt(marketResult);
       recordPlayerActivity(p.id,tokenHash(cookies(req).sid));finishStateOperation(opId);db.exec('COMMIT');dbCommitted=true;marketCommitted=true;
       return out(res,200,{ok:true,state:publicState(pid,st),result:marketResult});
     }
     throw new Error('Неизвестное действие рынка.');
   }catch(error){
     if(!dbCommitted&&!marketCommitted){
       try{db.exec('ROLLBACK')}catch{}
       if(opId)db.prepare("UPDATE state_operations SET status='cancelled',updated_at=? WHERE op_id=? AND status='pending'").run(now(),opId);
     }
     throw error;
   }
 })).catch(e=>{try{db.exec('ROLLBACK')}catch{};return err(res,400,e.message);});

 if(req.method==='POST'&&url.pathname==='/api/action')return body(req).then(x=>withPlayerActionLock(p.id,async()=>{
   const actionType=String(x.action||''),payload=x.payload||{};
   if(actionType==='openCase'){
     const requestId=String(x.idempotencyKey||'');
     if(!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))throw new Error('Не удалось подтвердить запрос открытия. Обновите игру.');
     db.exec('BEGIN IMMEDIATE');
     try{
       const previous=db.prepare('SELECT results_json FROM case_openings WHERE player_id=? AND request_id=?').get(p.id,requestId);
       if(previous){
         const fresh=db.prepare('SELECT state_json FROM players WHERE id=?').get(p.id);if(!fresh)throw new Error('Игрок не найден.');
         const saved=publicState(p.id,normalize(JSON.parse(fresh.state_json)));
         db.exec('COMMIT');
         return out(res,200,{ok:true,state:saved,result:JSON.parse(previous.results_json),replayed:true});
       }
       const fresh=db.prepare('SELECT * FROM players WHERE id=?').get(p.id);if(!fresh)throw new Error('Игрок не найден.');
       const current=normalize(JSON.parse(fresh.state_json));
       const opened=action(p.id,current,actionType,payload,fresh);
       const savedState=normalize(opened.state),result=opened.result||{};
       persistPlayerStateRow(p.id,savedState,fresh.state_version,now(),{reason:({openCase:'case_open',sell:'inventory_sale',sellAll:'inventory_sale',contract:'contract_trade',claimQuest:'quest_reward',dailyReward:'daily_reward',adCoins:'ad_reward',collectHouse:'house_income',upgradeHouse:'house_upgrade',sellHouse:'house_cycle',buyBackground:'background_purchase',selectAvatar:'avatar_purchase'})[actionType]||'game_action',operationId:actionType==='openCase'?requestId:null});
       const caseId=Math.floor(Number(payload.caseId));
       const quantity=Number(result.quantity)||1;
       const rewards=Array.isArray(result.items)?result.items:[];
       const tierCounts=[0,0,0,0,0,0,0];let totalVendorValue=0;let bestDrop=null;
       for(const reward of rewards){
         const itemId=Number(reward.item?.id),tier=Number(reward.tier);
         const vendorValue=Math.max(0,Math.floor(itemPrice(itemId,tier)));
         reward.vendorValue=vendorValue;totalVendorValue+=vendorValue;
         if(Number.isInteger(tier)&&tier>=1&&tier<=6)tierCounts[tier]++;
         if(!bestDrop||tier>bestDrop.tier||(tier===bestDrop.tier&&vendorValue>bestDrop.vendorValue))bestDrop={itemId,tier,vendorValue};
       }
       result.totalVendorValue=totalVendorValue;
       const ins=db.prepare('INSERT INTO case_openings(player_id,request_id,case_id,quantity,currency,total_cost,fast_fee_gems,total_vendor_value,results_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(p.id,requestId,caseId,quantity,String(result.currency||'coins'),Math.max(0,Math.floor(Number(result.totalCost)||0)),Math.max(0,Math.floor(Number(result.fastFeeGems)||0)),totalVendorValue,JSON.stringify(result),now());
       const openingId=Number(ins.lastInsertRowid);
       const addDrop=db.prepare('INSERT INTO case_opening_drops(opening_id,player_id,item_id,tier,vendor_value) VALUES(?,?,?,?,?)');
       for(const reward of rewards){addDrop.run(openingId,p.id,Number(reward.item?.id),Number(reward.tier),Number(reward.vendorValue)||0);}
       const coinSpent=result.currency==='coins'?Math.max(0,Math.floor(Number(result.totalCost)||0)):0;
       const gemSpent=result.currency==='gems'?Math.max(0,Math.floor(Number(result.totalCost)||0)):0;
       const upsertStats=db.prepare(`INSERT INTO player_case_stats(player_id,openings,cases,coin_spent,gem_spent,fast_gems,total_vendor_value,tier_1_count,tier_2_count,tier_3_count,tier_4_count,tier_5_count,tier_6_count,best_item_id,best_tier,best_vendor_value,updated_at)
         VALUES(?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(player_id) DO UPDATE SET openings=openings+1,cases=cases+excluded.cases,coin_spent=coin_spent+excluded.coin_spent,gem_spent=gem_spent+excluded.gem_spent,fast_gems=fast_gems+excluded.fast_gems,total_vendor_value=total_vendor_value+excluded.total_vendor_value,
         tier_1_count=tier_1_count+excluded.tier_1_count,tier_2_count=tier_2_count+excluded.tier_2_count,tier_3_count=tier_3_count+excluded.tier_3_count,tier_4_count=tier_4_count+excluded.tier_4_count,tier_5_count=tier_5_count+excluded.tier_5_count,tier_6_count=tier_6_count+excluded.tier_6_count,
         best_item_id=CASE WHEN excluded.best_tier>best_tier OR (excluded.best_tier=best_tier AND excluded.best_vendor_value>best_vendor_value) THEN excluded.best_item_id ELSE best_item_id END,
         best_tier=MAX(best_tier,excluded.best_tier),best_vendor_value=CASE WHEN excluded.best_tier>best_tier OR (excluded.best_tier=best_tier AND excluded.best_vendor_value>best_vendor_value) THEN excluded.best_vendor_value ELSE best_vendor_value END,updated_at=excluded.updated_at`);
       upsertStats.run(p.id,quantity,coinSpent,gemSpent,Math.max(0,Math.floor(Number(result.fastFeeGems)||0)),totalVendorValue,tierCounts[1],tierCounts[2],tierCounts[3],tierCounts[4],tierCounts[5],tierCounts[6],bestDrop?.itemId||null,bestDrop?.tier||0,bestDrop?.vendorValue||0,now());
       recordPlayerActivity(p.id,tokenHash(cookies(req).sid));
       db.exec('COMMIT');
       return out(res,200,{ok:true,state:publicState(p.id,savedState),result});
     }catch(e){try{db.exec('ROLLBACK')}catch{};throw e;}
   }
   const actionRequestId=String(x.idempotencyKey||'').trim();
   if(actionRequestId&&(!/^[A-Za-z0-9._:-]{8,128}$/.test(actionRequestId)))throw new Error('Некорректный ключ игрового действия.');
   const payloadHash=crypto.createHash('sha256').update(JSON.stringify({action:actionType,payload})).digest('hex');
   db.exec('BEGIN IMMEDIATE');
   try{
     if(actionRequestId){
       const prior=db.prepare('SELECT action_type,payload_hash,result_json FROM player_action_requests WHERE player_id=? AND request_id=?').get(p.id,actionRequestId);
       if(prior){
         if(prior.action_type!==actionType||prior.payload_hash!==payloadHash)throw new Error('Ключ уже использован для другого действия.');
         const currentRow=db.prepare('SELECT state_json FROM players WHERE id=?').get(p.id);
         const replayState=publicState(p.id,normalize(JSON.parse(currentRow.state_json)));
         const replayResult=JSON.parse(prior.result_json||'null');
         db.exec('COMMIT');
         return out(res,200,{ok:true,state:replayState,result:replayResult,replayed:true});
       }
     }
     const fresh=db.prepare('SELECT * FROM players WHERE id=?').get(p.id);if(!fresh)throw new Error('Игрок не найден.');
     const current=normalize(JSON.parse(fresh.state_json));
     const result=action(p.id,current,actionType,payload,fresh);
     const actionReason=({sell:'inventory_sale',sellAll:'inventory_sale',contract:'contract_trade',claimQuest:'quest_reward',dailyReward:'daily_reward',adCoins:'ad_reward',collectHouse:'house_income',upgradeHouse:'house_upgrade',sellHouse:'house_cycle',buyBackground:'background_purchase',selectAvatar:'avatar_purchase'})[actionType]||'game_action';
     const saved=commitState(p.id,result.state,fresh.state_version,{reason:actionReason,operationId:actionRequestId||null});
     if(actionRequestId)db.prepare('INSERT INTO player_action_requests(player_id,request_id,action_type,payload_hash,result_json,created_at) VALUES(?,?,?,?,?,?)').run(p.id,actionRequestId,actionType,payloadHash,JSON.stringify(result.result||null),now());
     recordPlayerActivity(p.id,tokenHash(cookies(req).sid));
     db.exec('COMMIT');
     return out(res,200,{ok:true,state:saved,result:result.result||null});
   }catch(error){try{db.exec('ROLLBACK')}catch{};throw error;}
 })).catch(e=>err(res,400,e.message));
 if(req.method==='POST'&&url.pathname==='/api/state')return err(res,410,'Прямое изменение состояния отключено. Используйте игровые действия.');
 if(req.method==='GET'&&url.pathname==='/api/leaderboard'){
   const p=getSession(req);if(!p)return err(res,401,'Требуется авторизация.');
   // Whitelisted metrics only: ranking comes exclusively from server-owned saved state.
   const metrics={rating:'rating',cases:'totalCasesOpened',level:'level',coins:'totalCoinsEarned'};
   const type=String(url.searchParams.get('type')||'rating');
   if(!Object.hasOwn(metrics,type))return err(res,400,'Неизвестный тип рейтинга.');
   const limit=Math.min(50,Math.max(1,Math.floor(Number(url.searchParams.get('limit'))||10)));
   const metric=metrics[type];
   const select=`id,username,COALESCE(NULLIF(json_extract(state_json,'$.nickname'),''),username) nickname,COALESCE(CAST(json_extract(state_json,'$.selectedAvatar') AS INTEGER),1) avatar,COALESCE(CAST(json_extract(state_json,'$.rating') AS INTEGER),0) rating,COALESCE(CAST(json_extract(state_json,'$.level') AS INTEGER),1) level,COALESCE(CAST(json_extract(state_json,'$.experience') AS INTEGER),0) experience,COALESCE(CAST(json_extract(state_json,'$.totalCasesOpened') AS INTEGER),0) cases,COALESCE(CAST(json_extract(state_json,'$.totalCoinsEarned') AS INTEGER),0) coins`;
   // Sorting is deterministic even for equal scores; leaderboard does not expose credentials.
   const score={rating:'rating',cases:'cases',level:'level',coins:'coins'}[type];
   const ranked=db.prepare(`WITH base AS (SELECT ${select} FROM players), ranked AS (SELECT base.*, ROW_NUMBER() OVER (ORDER BY ${score} DESC,rating DESC,level DESC,experience DESC,id ASC) AS rn FROM base) SELECT * FROM ranked WHERE rn<=? OR id=? ORDER BY rn`).all(limit,p.id);
   const toClient=(r)=>({rank:Number(r.rn),id:r.id,username:r.nickname||r.username,avatar:Number(r.avatar)||1,rating:r.rating||0,level:r.level||1,experience:r.experience||0,cases:r.cases||0,coins:r.coins||0,score:Number(r[score])||0});
   const players=ranked.filter(r=>Number(r.rn)<=limit).map(toClient);
   const mine=ranked.find(r=>Number(r.id)===Number(p.id));
   const total=Number(db.prepare('SELECT COUNT(*) c FROM players').get()?.c||0);
   return out(res,200,{ok:true,type,players,me:mine?toClient(mine):null,total});
 }
 return err(res,404,'API endpoint not found.');
}

const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'application/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.mp3':'audio/mpeg','.ogg':'audio/ogg','.ttf':'font/ttf','.otf':'font/otf','.woff':'font/woff','.woff2':'font/woff2','.ico':'image/x-icon'};
function safeFile(urlPath){let decoded;try{decoded=decodeURIComponent(urlPath)}catch{return null;}if(decoded.includes('\0'))return null;let rel=decoded.replace(/^\/+/, '');if(!rel)rel='index.html';const file=path.resolve(PUBLIC,rel);if(file!==PUBLIC&&!file.startsWith(PUBLIC+path.sep))return null;return file;}
// Static assets are streamed for ordinary requests. Compress only textual assets
// when requested by the client; keep binary images and audio byte-for-byte.
const compressible=new Set(['.html','.css','.js','.json']);
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);
    if(url.pathname.startsWith('/api/'))return await api(req,res,url);
    if(req.method!=='GET'&&req.method!=='HEAD')return err(res,405,'Метод не поддерживается.');
    const file=safeFile(url.pathname);
    if(!file)return err(res,400,'Некорректный путь.');
    fs.stat(file,(e,st)=>{
      if(e||!st.isFile())return err(res,404,'Файл не найден.');
      const ext=path.extname(file).toLowerCase();
      const gzip=compressible.has(ext)&&st.size>=1024&&/\bgzip\b/.test(String(req.headers['accept-encoding']||''));
      const headers={
        'Content-Type':mime[ext]||'application/octet-stream',
        'X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN',
        'Referrer-Policy':'same-origin','Cross-Origin-Resource-Policy':'same-origin',
        'Cache-Control':'no-cache', 'Vary':'Accept-Encoding'
      };
      if(gzip)headers['Content-Encoding']='gzip';
      res.writeHead(200,headers);
      if(req.method==='HEAD')return res.end();
      const stream=fs.createReadStream(file);
      stream.on('error',error=>{console.error('[STATIC]',error);res.destroy(error);});
      if(gzip){const zipped=zlib.createGzip({level:zlib.constants.Z_BEST_SPEED});zipped.on('error',error=>res.destroy(error));stream.pipe(zipped).pipe(res);}
      else stream.pipe(res);
    });
  }catch(e){console.error('[SERVER]',e);if(!res.headersSent)err(res,500,'Внутренняя ошибка сервера.');}
});
server.on('connection',socket=>socket.setNoDelay(true));

server.listen(PORT,HOST,()=>console.log(`Zombix Simulator server: http://${HOST}:${PORT}`));
