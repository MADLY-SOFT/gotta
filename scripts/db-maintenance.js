#!/usr/bin/env node
'use strict';
// Run with the game server stopped. Default mode is read-only; --apply performs
// bounded SQLite maintenance and VACUUM, never schema or player-data rewrites.
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {verifyPlayerProjections}=require('../lib/player-projection');
const dir=path.resolve(process.env.ZOMBIX_DATA_DIR||path.join(__dirname,'..','server-data'));
const apply=process.argv.includes('--apply');
const files=['game.sqlite','market.sqlite'];
let failed=false;
for(const name of files){
 const file=path.join(dir,name);
 if(!fs.existsSync(file)){console.log(`[SKIP] ${name}: not present`);continue;}
 let db;
 try{
  db=new DatabaseSync(file,{readOnly:!apply});
  const check=db.prepare('PRAGMA integrity_check').all().map(x=>Object.values(x)[0]);
  const ok=check.length===1&&check[0]==='ok';
  console.log(`[${ok?'OK':'FAIL'}] ${name}: integrity_check=${check.join('; ')}`);
  if(!ok)failed=true;
  if(name==='game.sqlite'&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='player_wallets'").get()){
   const projection=verifyPlayerProjections(db);
   console.log(`[${projection.ok?'OK':'FAIL'}] ${name}: player projections ${projection.players} players, ${projection.errors.length} mismatches`);
   if(!projection.ok){console.error(JSON.stringify(projection.errors.slice(0,20)));failed=true;}
  }
  if(apply&&ok){
   try{db.exec('PRAGMA wal_checkpoint(TRUNCATE)');}catch(e){console.warn(`[WARN] checkpoint ${name}: ${e.message}`);}
   db.exec('PRAGMA optimize');
   db.exec('ANALYZE');
   db.exec('VACUUM');
   console.log(`[DONE] ${name}: checkpoint, optimize, analyze, vacuum`);
  }
 }catch(e){failed=true;console.error(`[FAIL] ${name}: ${e.message}`);}
 finally{try{db?.close();}catch{}}
}
if(apply)console.log('Maintenance finished. Re-run npm run db:check before starting the server.');
else console.log('Read-only check complete. Stop the game server and run npm run db:optimize to apply maintenance.');
process.exitCode=failed?1:0;
