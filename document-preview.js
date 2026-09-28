(function(){
  'use strict';
  let activeUrl='';
  let previewFile=null;
  function clearPreviewFile(){if(activeUrl){URL.revokeObjectURL(activeUrl);activeUrl='';}previewFile=null;}
  function previewDialog(){return window.document.getElementById('preview');}
  function editPreviewDocument(){if(typeof previewDoc!=='undefined'&&previewDoc?.id)window.editDocument(previewDoc.id);}
  async function openNativePreview(id){
    const record=(((typeof db!=='undefined'&&db.documents)||[])).find(item=>item&&item.id===id);
    if(!record){window.toast?.('Document not found.');return;}
    const dialog=previewDialog();
    if(!dialog)return;
    clearPreviewFile();
    previewDoc=structuredClone(record);
    dialog.innerHTML=`<div class="modalbar"><div><strong>${window.docLabel?window.docLabel(record.type):record.type} preview</strong><small>${window.esc?window.esc(record.number):record.number}</small></div><div class="actions"><button id="nativePreviewDownload" disabled>Download PDF</button><button id="nativePreviewEdit">Edit</button><button onclick="document.getElementById('preview').close()">Close</button></div></div><div id="previewBody" class="native-pdf-preview"><p class="sub">Creating your document preview…</p></div>`;
    dialog.querySelector('#nativePreviewEdit').onclick=editPreviewDocument;
    if(!dialog.open)dialog.showModal();
    try{
      previewFile=await window.createDocumentPdf(record);
      activeUrl=URL.createObjectURL(previewFile);
      const body=dialog.querySelector('#previewBody');
      if(!body)return;
      body.innerHTML=`<iframe title="${window.esc?window.esc(record.number):record.number} PDF preview" src="${activeUrl}#view=FitH" type="application/pdf"></iframe>`;
      const download=dialog.querySelector('#nativePreviewDownload');
      download.disabled=false;
      download.onclick=()=>window.downloadPdfFile(previewFile);
    }catch(error){
      const body=dialog.querySelector('#previewBody');
      if(body)body.innerHTML=`<div class="empty"><h2>Preview could not be created.</h2><p>${window.esc?window.esc(error?.message||'Please try again.'):'Please try again.'}</p></div>`;
    }
  }
  window.showPreview=openNativePreview;
  window.downloadPreviewPdf=()=>{if(previewFile)window.downloadPdfFile(previewFile);else if(typeof previewDoc!=='undefined'&&previewDoc)window.downloadDocumentFile(previewDoc);};
  window.document.addEventListener('close',event=>{if(event.target?.id==='preview')clearPreviewFile();},true);
})();

