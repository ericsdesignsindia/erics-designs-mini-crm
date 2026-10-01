/* Present concise payment information in the Accounts ledger without altering saved records. */
(function(){
  const priorAccountLedgerRow=accountLedgerRow;
  const concisePaymentNote=row=>{
    if(!row?.employeeId&&!row?.vendorBillId)return row?.note||'—';
    const employee=(db.employees||[]).find(item=>item.id===row.employeeId);
    const excluded=new Set(['employee payment','vendor bill',String(employee?.name||'').toLowerCase(),String(row.paymentSource||'').toLowerCase(),String(row.paymentMode||'').toLowerCase(),'operating balance','opening balance','external payment','cash','upi','bank transfer','card','cheque']);
    const parts=String(row.note||'').split(' · ').map(value=>value.trim()).filter(value=>value&&!excluded.has(value.toLowerCase()));
    return parts.join(' · ')||(row.employeeId?'Employee payment':'Vendor payment');
  };
  accountLedgerRow=function(row){return priorAccountLedgerRow({...row,note:concisePaymentNote(row)})};
})();
