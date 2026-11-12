'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {sanitizeInventory}=require('../lib/inventory');
const items=new Map([[1,{id:1,tiers:{'1':{},'2':{}}}],[2,{id:2,tiers:{'1':{}}}]]);
test('inventory preserves all valid instances beyond the former 200-item cap',()=>{
 const source=Array.from({length:5200},(_,i)=>({id:i%2?1:2,tier:1}));
 const result=sanitizeInventory(source,items);
 assert.equal(result.length,5200);assert.deepEqual(result[0],{id:2,tier:1});assert.deepEqual(result[5199],{id:1,tier:1});
});
test('inventory sanitizer removes invalid references but keeps order and duplicates',()=>{
 const result=sanitizeInventory([{id:1,tier:2},{id:999,tier:1},{id:1,tier:2},{id:2,tier:6}],items);
 assert.deepEqual(result,[{id:1,tier:2},{id:1,tier:2}]);
});
test('inventory overflow fails explicitly instead of silently deleting saved items',()=>{
 assert.throws(()=>sanitizeInventory(Array(4).fill({id:1,tier:1}),items,3),e=>e.code==='INVENTORY_LIMIT_EXCEEDED');
});
