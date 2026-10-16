import {describe,it,expect} from 'vitest';
import {satisfiableRange} from '../../src/lib/file-range';
describe('authorized download byte range boundaries',()=>{
 it('accepts bounded, open and suffix ranges including a clipped end',()=>{
  for(const value of ['bytes=0-15','bytes=111-','bytes=-1','bytes=-200','bytes=0-200'])expect(satisfiableRange(value,112)).toBe(true);
 });
 it('rejects unsatisfiable, reversed, multiple and malformed ranges',()=>{
  for(const value of ['bytes=112-','bytes=999999999-','bytes=5-3','bytes=-0','bytes=-','bytes=0-1,3-4','items=0-1'])expect(satisfiableRange(value,112)).toBe(false);
 });
});
