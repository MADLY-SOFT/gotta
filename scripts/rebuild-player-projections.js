#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {ensurePlayerProjectionSchema,syncPlayerProjection,verifyPlayerProjections}=require('../lib/player-projection');
const dataDir=path.resolve(process.env.ZOMBIX_DATA_DIR||path.join(__dirname,'..','server-data'));
const dbPath=path.join(dataDir,'game.sqlite');
let db;
function now(){return Date.now();}
try{
 if(!fs.existsSync(dbPath))throw new Error(`Database does not exist: ${dbPath}`);
 db=new DatabaseSync(dbPath);
 db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
 const backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const backupPath=path.join(backupDir,`game-before-projection-rebuild-${stamp}-${crypto.randomBytes(3).toString('hex')}.sqlite`);
 db.exec(`VACUUM INTO '${backupPath.replace(/'/g,"''")}'`);
 ensurePlayerProjectionSchema(db);
 db.exec('BEGIN IMMEDIATE');
 try{
  const players=db.prepare('SELECT id,state_json FROM players ORDER BY id').all();
  for(const player of players){
   let state;try{state=JSON.parse(player.state_json||'{}')}catch{throw new Error(`Invalid state_json for player #${player.id}; rebuild aborted.`)}
   syncPlayerProjection(db,Number(player.id),state,{now:now(),reason:'projection_rebuild'});
  }
  db.exec('COMMIT');
 }catch(error){try{db.exec('ROLLBACK')}catch{};throw error;}
 const result=verifyPlayerProjections(db);
 console.log(JSON.stringify({backup:path.relative(dataDir,backupPath),...result},null,2));
 if(!result.ok)process.exitCode=1;
}catch(error){console.error(`[PROJECTION REBUILD FAILED] ${error.message}`);process.exitCode=1;}
finally{try{db?.close()}catch{}}
