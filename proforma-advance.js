/* Downloaded proformas are advance requests, not full-value invoices. */
(function(){
 const original=window.createProformaPdf;
 if(typeof original!=='function')return;
 const advanceDocument=document=>({...document,items:(document.items||[]).map(item=>{const quantity=Number(item.qty||1)||1,full=Number(item.proformaAmount??(quantity*Number(item.rate||0)))||0,advance=Math.round((full/2+Number.EPSILON)*100)/100;return {...item,rate:advance/quantity,rateText:'',proformaAmount:advance}})});
 window.createProformaPdf=document=>original(advanceDocument(document));
 window.createDocumentPdf=document=>document?.type==='Invoice'?window.createInvoicePdf(document):document?.type==='Proforma'?window.createProformaPdf(document):window.createQuotationPdf(document);
})();
