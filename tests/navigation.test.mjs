import assert from 'node:assert/strict';
import test from 'node:test';
import { groups,toolAccess } from '../src/navigation.ts';

test('groups map every existing tool once',()=>{
  assert.equal(groups.length,6);
  assert.deepEqual(groups.flatMap(group=>[...group.tabs]).sort((a,b)=>a-b),Array.from({length:16},(_,id)=>id));
});

test('permissions hide tools before evaluating subscription availability',()=>{
  assert.equal(toolAccess(10,false,[],false,false),'hidden');
  assert.equal(toolAccess(10,false,['inventory'],false,false),'plan');
  assert.equal(toolAccess(10,false,['inventory'],false,true),'open');
  assert.equal(toolAccess(15,false,['customer'],true),'hidden');
  assert.equal(toolAccess(9,false,['ai'],false),'open');
  assert.equal(toolAccess(14,false,['analytics'],false),'open');
  assert.equal(toolAccess(10,true,[],false,false),'plan');
});
