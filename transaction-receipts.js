/* Transaction receipts: editable receipt details for every money-in and money-out record. */
(function(){
  const receiptRows={};
  const latestRow=id=>accountLedger().find(row=>row.id===id)||receiptRows[id];
  const paymentFor=(document,row)=>document?.payments?.find(payment=>String(payment.date||'')===String(row.date||'')&&Number(payment.amount||0)===Number(row.amount||0))||document?.payments?.find(payment=>Number(payment.amount||0)===Number(row.amount||0));
  const sourceFor=row=>{
    if(row.source==='invoice'||row.source==='proforma'){
      const document=db.documents.find(item=>item.id===(row.invoiceId||row.proformaId));
      const payment=paymentFor(document,row);
      return {kind:'payment',target:payment,document,counterparty:document?.client?.name||'Client'};
    }
    if(row.vendorBillId){const bill=(db.vendorBills||[]).find(item=>item.id===row.vendorBillId);return {kind:'vendor',target:bill,bill,counterparty:bill?.vendor||'Vendor'};}
    const entry=(db.accounts||[]).find(item=>item.id===row.id);
    const employee=entry?.employeeId?(db.employees||[]).find(item=>item.id===entry.employeeId):null;
    return {kind:'account',target:entry,counterparty:employee?.name||entry?.counterparty||entry?.note||'Business transaction'};
  };
  const defaultReceipt=(row,source)=>({
    number:`${row.type==='Income'?'ED-R':'ED-PV'}-${String(row.date||today()).replace(/-/g,'')}-${String(row.id||uid()).replace(/[^a-z0-9]/gi,'').slice(-5).toUpperCase()}`,
    date:row.date||today(),kind:row.type==='Income'?'Payment receipt':'Payment voucher',counterparty:source.counterparty||'Counterparty',reference:row.paymentMode||row.note||row.category||'Transaction',notes:row.type==='Income'?'Payment received and recorded in the Eric’s Designs Accounts ledger.':'Payment made and recorded in the Eric’s Designs Accounts ledger.'
  });
  const receiptDocument=(row,receipt)=>({
    type:'Receipt',receiptKind:row.type==='Income'?'Payment receipt':'Payment voucher',number:receipt.number,date:receipt.date,due:receipt.date,currency:row.currency||'INR',business:db.settings,
    client:{name:receipt.counterparty||'Counterparty'},payments:[{date:receipt.date,amount:Number(row.amount||0),info:row.note||row.category||'Transaction',method:receipt.reference||row.paymentMode||'—',reference:receipt.reference||row.paymentMode||row.note||'Transaction'}],
    receiptNotes:receipt.notes||'',terms:receipt.notes||''
  });
  const writeReceipt=(row,receipt)=>{
    const source=sourceFor(row);if(!source.target)return false;
    source.target.receipt={...receipt,updatedAt:new Date().toISOString()};return true;
  };
  window.downloadTransactionReceipt=async function(id){
    const row=latestRow(id);if(!row)return toast('Transaction not found. Refresh Accounts and try again.');
    const source=sourceFor(row),receipt=source.target?.receipt||defaultReceipt(row,source);
    try{const label=row.type==='Income'?'Payment receipt':'Payment voucher';toast('Creating '+label.toLowerCase()+'…');downloadPdfFile(await createPaymentReceiptPdf(receiptDocument(row,receipt)));toast(label+' downloaded.');}catch(error){toast(error?.message||'Could not create the receipt PDF.');}
  };
  window.editTransactionReceipt=function(id){
    const row=latestRow(id);if(!row)return toast('Transaction not found. Refresh Accounts and try again.');
    const source=sourceFor(row),receipt=structuredClone(source.target?.receipt||defaultReceipt(row,source));
    const voucher=row.type!=='Income',label=voucher?'Payment voucher':'Payment receipt',partyLabel=voucher?'Paid to *':'Received from *';
    modal('Edit '+label,`<p class="sub">${label} details are stored with this transaction. Editing the transaction itself remains available from Accounts.</p>${field((voucher?'Voucher':'Receipt')+' number *','transaction-receipt-number',receipt.number,'text','required')}${field('Receipt date *','transaction-receipt-date',receipt.date,'date','required')}${field(partyLabel,'transaction-receipt-party',receipt.counterparty,'text','required')}<div class="full"><label for="transaction-receipt-reference">Reference / payment method</label><input id="transaction-receipt-reference" value="${esc(receipt.reference||'')}"></div><div class="full"><label for="transaction-receipt-notes">Receipt notes</label><textarea id="transaction-receipt-notes">${esc(receipt.notes||'')}</textarea></div>`,()=>window.saveTransactionReceipt(id,false));
    const actions=document.querySelector('#recordForm .actions');if(actions)actions.insertAdjacentHTML('beforeend',`<button type="button" class="primary" onclick="saveTransactionReceipt('${esc(id)}',true)">Save & download PDF</button>`);
  };
  window.saveTransactionReceipt=async function(id,download){
    const row=latestRow(id);if(!row)return;
    const receipt={number:val('transaction-receipt-number').trim(),date:val('transaction-receipt-date'),counterparty:val('transaction-receipt-party').trim(),reference:val('transaction-receipt-reference').trim(),notes:val('transaction-receipt-notes').trim()};
    if(!receipt.number||!receipt.date||!receipt.counterparty){document.getElementById('recordError').textContent='Add a receipt number, date, and counterparty.';return;}
    if(!commitChange(()=>{if(!writeReceipt(row,receipt))throw new Error('The linked transaction was not found.');},'Saved receipt details'))return;
    closeSaved();
    if(download){try{const label=row.type==='Income'?'Payment receipt':'Payment voucher';toast('Creating '+label.toLowerCase()+'…');downloadPdfFile(await createPaymentReceiptPdf(receiptDocument(row,receipt)));toast(label+' downloaded.');}catch(error){toast(error?.message||'Receipt details were saved, but the PDF could not be created.');}}
  };
  window.editReceiptTransaction=function(id){
    const row=latestRow(id);if(!row)return;const source=sourceFor(row);
    if(source.kind==='payment')return openDoc(source.document.id);
    if(source.kind==='vendor')return editVendorBill(source.bill.id);
    if(source.target)return editAccount(source.target.id);
    toast('The original transaction cannot be found.');
  };
  const originalLedgerRows=accountLedgerRows;
  accountLedgerRows=function(rows){
    for(const row of rows)receiptRows[row.id]=row;
    return originalLedgerRows(rows);
  };
  const originalLedgerRow=accountLedgerRow;
  accountLedgerRow=function(row){
    const controls=`<button class="smallbtn" onclick="downloadTransactionReceipt('${esc(row.id)}')">${row.type==='Income'?'Receipt PDF':'Voucher PDF'}</button><button class="smallbtn" onclick="editTransactionReceipt('${esc(row.id)}')">${row.type==='Income'?'Edit receipt':'Edit voucher'}</button><button class="smallbtn" onclick="editReceiptTransaction('${esc(row.id)}')">Edit transaction</button>`;
    const markup=originalLedgerRow(row);
    return markup.replace(/<\/td><\/tr>$/,controls+'</td></tr>');
  };
})();

/* Allow payment receipts for proforma advances and final-invoice payments. */
(function () {
  window.downloadPaymentReceiptPdf = async function () {
    if (!previewDoc || !Array.isArray(previewDoc.payments) || !previewDoc.payments.length) {
      toast('Record a payment before creating a receipt.');
      return;
    }
    try {
      toast('Creating payment receipt…');
      const receipt = { ...previewDoc, receiptNotes: previewDoc.type === 'Proforma' ? 'This receipt confirms the advance payment received against the proforma invoice.' : 'This receipt confirms the payment received.' };
      downloadPdfFile(await createPaymentReceiptPdf(receipt));
      toast('Payment receipt downloaded.');
    } catch (error) {
      toast(error?.message || 'Could not create the payment receipt.');
    }
  };

  showPaymentReceipt = function () {
    if (!draft || !Array.isArray(draft.payments) || !draft.payments.length) {
      toast('Record a payment before creating a receipt.');
      return;
    }
    previewDoc = structuredClone(draft);
    const label = draft.type === 'Proforma' ? 'Advance payment receipt' : 'Payment receipt';
    const dialog = document.getElementById('preview');
    dialog.innerHTML = `<div class="modalbar"><div><strong>${label}</strong><small>${esc(previewDoc.number)}</small></div><div class="actions"><button class="primary" onclick="downloadPaymentReceiptPdf()">Download receipt PDF</button><button onclick="document.getElementById('preview').close()">Close</button></div></div><div id="previewBody"><article class="document receipt"><h2>${label} ready</h2><p>${esc(previewDoc.client?.name || 'Client')} · ${esc(previewDoc.number)}</p><p>Payment recorded: <b>${esc(fmt(previewDoc, totals(previewDoc).paid))}</b></p></article></div>`;
    dialog.showModal();
  };
})();
