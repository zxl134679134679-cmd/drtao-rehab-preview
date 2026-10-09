import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoModel } from './core.js';
import { ensureSchedules } from './schedules.js';
import { bookingAvailability,customerBookingTherapists } from './booking-availability.js';
const fresh=()=>{const m=new DemoModel();ensureSchedules(m);return m;};
test('time choices respect full service length, rest days, unpublished days and recorded bookings',()=>{
 const m=fresh(),base={principalId:'t1',clientId:'c3',storeId:'a',date:m.today,time:'18:00'};
 assert.equal(bookingAvailability(m,base).available,true);
 for(const input of [{...base,time:'18:30'},{...base,time:'14:30'},{...base,date:'2026-11-01'},{...base,principalId:'t5',clientId:'c5'}])assert.equal(bookingAvailability(m,input).available,false);
 assert.equal(bookingAvailability(m,{...base,time:'14:00',excludeId:'a3'}).available,true);
});
test('customer staff choices include only eligible therapists in the selected store and date',()=>{
 const m=fresh();
 assert.deepEqual(customerBookingTherapists(m,'c1','a','2026-10-09').map(t=>t.id),['t1','t3']);
 assert.deepEqual(customerBookingTherapists(m,'c1','b','2026-10-09').map(t=>t.id),['t2']);
 assert.deepEqual(customerBookingTherapists(m,'c3','b','2026-10-09'),[]);
});
