#!/usr/bin/env node
'use strict';
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {verifyPlayerProjections}=require('../lib/player-projection');
const dir=path.resolve(process.env.ZOMBIX_DATA_DIR||path.join(__dirname,'..','server-data'));
const file=path.join(dir,'game.sqlite');
let db;
try{
 db=new DatabaseSync(file,{readOnly:true});
 const result=verifyPlayerProjections(db);
 console.log(JSON.stringify(result,null,2));
 if(!result.ok)process.exitCode=1;
}catch(error){console.error(`[DB PROJECTION CHECK] ${error.message}`);process.exitCode=1;}
finally{try{db?.close()}catch{}}
