'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {spawnSync}=require('node:child_process');const {DatabaseSync}=require('node:sqlite');
const ROOT=path.resolve(__dirname,'..');
test('database maintenance performs read-only integrity check and explicit optimize on fixtures',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zombix-db-maint-'));
 try{
  const db=new DatabaseSync(path.join(dir,'game.sqlite'));db.exec('CREATE TABLE sample(id INTEGER PRIMARY KEY,value TEXT);INSERT INTO sample(value) VALUES(\'kept\')');db.close();
  const check=spawnSync(process.execPath,[path.join(ROOT,'scripts/db-maintenance.js')],{cwd:ROOT,env:{...process.env,ZOMBIX_DATA_DIR:dir},encoding:'utf8'});
  assert.equal(check.status,0,check.stderr+check.stdout);assert.match(check.stdout,/integrity_check=ok/);
  const apply=spawnSync(process.execPath,[path.join(ROOT,'scripts/db-maintenance.js'),'--apply'],{cwd:ROOT,env:{...process.env,ZOMBIX_DATA_DIR:dir},encoding:'utf8'});
  assert.equal(apply.status,0,apply.stderr+apply.stdout);assert.match(apply.stdout,/checkpoint, optimize, analyze, vacuum/);
  const verify=new DatabaseSync(path.join(dir,'game.sqlite'),{readOnly:true});assert.equal(verify.prepare('SELECT value FROM sample').get().value,'kept');verify.close();
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
