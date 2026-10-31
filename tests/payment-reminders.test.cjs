'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {DEFAULT_TEMPLATES,addCalendarDays,scheduledDates}=require('../payment-reminders.js');

test('first reminder uses the requested copy and fixed company name',()=>{
  assert.equal(DEFAULT_TEMPLATES.stage1,'Hello {{client}},\n\nThis is a friendly reminder that {{amount}} remains outstanding for {{project}} ({{invoice}}). Our records show the payment due date as {{due_date}}.\n\nPlease let us know when we can expect payment, or contact us if you need a copy of the document.\n\nThank you,\n{{company}}');
});

test('reminder schedule anchors each stage to the prior sent date',()=>{
  assert.equal(addCalendarDays('2026-10-31',1),'2026-11-01');
  assert.deepEqual(scheduledDates('2026-10-20',{stage1:'2026-10-24',stage2:'2026-10-27',stage3:'2026-10-30'}).map(stage=>stage.due),['2026-10-23','2026-10-27','2026-10-30','2026-10-31']);
  assert.deepEqual(scheduledDates('',{}).map(stage=>stage.due),['','','','']);
});

test('reminder workspace lists unpaid invoices and proformas without mutating records',async()=>{
  const invoice={id:'invoice-1',type:'Invoice',status:'Sent',number:'ED-0001',date:'2026-10-01',due:'2026-10-28',project:'SEO',client:{id:'client-1',name:'Client A'},items:[{name:'SEO'}],payments:[],currency:'INR',balance:1200,paymentReminder:{completionDate:'2026-10-20',sent:{}}};
  const proforma={id:'proforma-1',type:'Proforma',status:'Accepted',number:'ED-P-0001',due:'2026-10-29',project:'Website',client:{id:'client-2',name:'Client B'},items:[{name:'Website'}],payments:[],currency:'INR',balance:3500};
  const linkedProforma={...proforma,id:'proforma-linked',number:'ED-P-0002'};
  const linkedInvoice={...invoice,id:'invoice-linked',number:'ED-0002',sourceId:'proforma-linked'};
  const app={innerHTML:''},textarea={value:'',addEventListener(){}},filledPreview={textContent:''};let editorHtml='';
  const saved=[];class FakePdf{constructor(){this.lines=[];this.images=[]}setFillColor(){}rect(){}setTextColor(){}setFont(){}setFontSize(){}text(value){this.lines.push(String(value))}splitTextToSize(value){return String(value).split('\n')}setDrawColor(){}setLineWidth(){}line(){}addImage(...args){this.images.push(args)}addPage(){}save(filename){saved.push({filename,lines:this.lines,images:this.images})}}
  class FakeFileReader{readAsDataURL(){this.result='data:image/png;base64,crm-landscape-logo';this.onload()}}
  const sandbox={
    window:{jspdf:{jsPDF:FakePdf}},document:{getElementById:id=>id==='app'?app:id==='payment-reminder-content'?textarea:id==='payment-reminder-filled-preview'?filledPreview:null},view:'Payment reminders',db:{documents:[invoice,proforma,linkedProforma,linkedInvoice],clients:[{id:'client-1',name:'Canonical Client A',contact:'Accounts',email:'accounts@example.test',phone:'12345'}],projects:[],settings:{businessName:'Wrong setting'}},
    totals:row=>({balance:row.balance}),today:()=> '2026-11-01',fmt:(_row,amount)=>`INR ${amount}`,esc:value=>String(value).replaceAll('&','&amp;'),
    pageHeader:()=>'<header></header>',accounts:()=>'<header>Accounts</header>',render:()=>{},nav:()=>{},
    field:()=>'',modal:(_title,html)=>{editorHtml=html},commitChange:work=>{work();return true},closeSaved:()=>{},val:()=>'',toast:()=>{},confirm:()=>true,console,
    addEventListener:()=>{},fetch:async url=>({ok:url.includes('erics-designs-crm-logo.png'),blob:async()=>({})}),FileReader:FakeFileReader
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../payment-reminders.js'),'utf8'),sandbox);
  sandbox.render();
  assert.match(app.innerHTML,/Pending invoices and payments/);
  assert.match(app.innerHTML,/ED-0001/);
  assert.match(app.innerHTML,/ED-P-0001/);
  assert.doesNotMatch(app.innerHTML,/ED-P-0002/,'a proforma linked to an issued final invoice should not be reminded twice');
  assert.match(app.innerHTML,/Final notice/);
  assert.equal(proforma.paymentReminder,undefined,'rendering the queue should not write reminder state');
  assert.equal(typeof sandbox.window.editPaymentReminderContent,'function');
  sandbox.window.editPaymentReminderContent('invoice-1','stage1');
  assert.match(editorHtml,/Canonical Client A/);
  assert.match(editorHtml,/ED-0001/);
  assert.match(editorHtml,/INR 1200/);
  assert.match(editorHtml,/Erics Designs/);
  textarea.value='Hello {{client}} — {{amount}} — {{company}}';
  sandbox.window.updatePaymentReminderPreview('invoice-1','stage1');
  assert.equal(filledPreview.textContent,'Hello Canonical Client A — INR 1200 — Erics Designs');
  sandbox.window.recordPaymentReminderSent('invoice-1','stage1');
  assert.equal(invoice.paymentReminder.sent.stage1,'2026-11-01');
  sandbox.window.recordPaymentReminderSent('invoice-1','stage2');
  assert.equal(invoice.paymentReminder.sent.stage2,undefined,'later reminders stay blocked until their waiting interval passes');
  await sandbox.window.generatePaymentReminderPdf('invoice-1','final','Hello {{client}} — {{amount}} for {{invoice}} — {{company}}');
  assert.equal(saved[0].filename,'ED-0001-final-payment-reminder.pdf');
  assert.equal(saved[0].images[0][0],'data:image/png;base64,crm-landscape-logo','embed the CRM landscape logo');
  assert.equal(saved[0].images[0][1],'PNG');
  assert.ok(Math.abs(saved[0].images[0][4]/saved[0].images[0][5]-2627/810)<0.001,'preserve the landscape logo aspect ratio');
  assert.match(saved[0].lines.join(' '),/Canonical Client A/);
  assert.match(saved[0].lines.join(' '),/INR 1200/);
  assert.match(saved[0].lines.join(' '),/OUTSTANDING AMOUNT/);
  assert.match(saved[0].lines.join(' '),/REMINDER DETAILS/);
  assert.match(saved[0].lines.join(' '),/Erics Designs/);
  assert.doesNotMatch(saved[0].lines.join(' '),/Wrong setting/);
  assert.equal(invoice.paymentReminder.sent.final,undefined,'PDF generation must not mark a notice sent');
});
