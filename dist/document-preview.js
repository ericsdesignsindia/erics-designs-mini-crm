(function(){
'use strict';
let activeUrl='',previewFile=null,generation=0;
function clear(){generation++;if(activeUrl)URL.revokeObjectURL(activeUrl);activeUrl='';previewFile=null;}
async function openRecord(record,receipt=false){
 const dialog=document.getElementById('preview');if(!dialog)return;
 clear();const request=generation;previewDoc=structuredClone(record);
 const label=receipt?'Payment receipt':docLabel(record.type);
 dialog.innerHTML=`<div class="modalbar"><div><strong>${esc(label)} preview</strong><small>${esc(record.number||'')}</small></div><div class="actions"><button id="nativePreviewDownload" disabled>Download PDF</button><button id="nativePreviewEdit">Edit</button><button id="nativePreviewClose">Close</button></div></div><div id="previewBody" class="native-pdf-preview"><p>Creating your document preview...</p></div>`;
 dialog.querySelector('#nativePreviewEdit').onclick=()=>{clear();editDocument(record.id)};
 dialog.querySelector('#nativePreviewClose').onclick=()=>dialog.close();
 if(!dialog.open)dialog.showModal();
 try{const file=await (receipt?window.createPaymentReceiptPdf(record):window.createDocumentPdf(record));if(request!==generation||!dialog.open)return;previewFile=file;activeUrl=URL.createObjectURL(file);dialog.querySelector('#previewBody').innerHTML=`<iframe title="${esc(record.number||'Document')} PDF preview" src="${activeUrl}#view=FitH"></iframe>`;const button=dialog.querySelector('#nativePreviewDownload');button.disabled=false;button.onclick=()=>downloadPdfFile(file)}catch(error){if(request===generation&&dialog.open)dialog.querySelector('#previewBody').innerHTML=`<div class="empty"><h2>Preview could not be created.</h2><p>${esc(error.message||'Please try again.')}</p></div>`;}
}
window.showPreview=id=>{const record=db.documents.find(item=>item?.id===id);if(!record)return toast('Document not found.');return openRecord(record)};
window.previewDraft=()=>{if(draft)return openRecord(structuredClone(draft));};
window.showPaymentReceipt=()=>{if(!draft?.payments?.length)return toast('Record a payment before creating a receipt.');return openRecord(structuredClone(draft),true)};
window.downloadPreviewPdf=()=>{if(previewFile)downloadPdfFile(previewFile);else toast('Wait for the PDF preview to finish.');};
window.printDoc=window.downloadPreviewPdf;
document.addEventListener('close',event=>{if(event.target?.id==='preview')clear()},true);
})();
