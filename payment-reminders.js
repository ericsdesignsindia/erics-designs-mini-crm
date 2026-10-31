/* Staged reminders for unpaid invoices and proforma advances. */
(function(){
  const STAGES=[
    {key:'stage1',label:'First reminder',delay:3},
    {key:'stage2',label:'Second reminder',delay:3},
    {key:'stage3',label:'Third reminder',delay:3},
    {key:'final',label:'Final notice',delay:1}
  ];
  const DEFAULT_TEMPLATES={
    stage1:'Hello {{client}},\n\nThis is a friendly reminder that {{amount}} remains outstanding for {{project}} ({{invoice}}). Our records show the payment due date as {{due_date}}.\n\nPlease let us know when we can expect payment, or contact us if you need a copy of the document.\n\nThank you,\n{{company}}',
    stage2:'Hello {{client}},\n\nWe are following up again regarding the outstanding amount of {{amount}} for {{project}} ({{invoice}}), due {{due_date}}.\n\nPlease arrange payment or reply with an update. If you have already paid, please share the payment reference so we can update our records.\n\nRegards,\n{{company}}',
    stage3:'Hello {{client}},\n\nThis is our third reminder for {{amount}} outstanding on {{project}} ({{invoice}}), due {{due_date}}.\n\nPlease arrange payment promptly or contact us to discuss the status. If payment has been made, please send the reference.\n\nRegards,\n{{company}}',
    final:'FINAL PAYMENT NOTICE\n\nHello {{client}},\n\nDespite our previous reminders, {{amount}} remains outstanding for {{project}} ({{invoice}}), due {{due_date}}.\n\nPlease settle the balance or contact us within one day of this notice. If the balance remains unpaid, Eric’s Designs may terminate the service agreement and suspend or revoke unpaid services only as permitted by the signed contract and applicable law. Please contact us immediately if you believe this notice is in error.\n\nRegards,\n{{company}}'
  };

  function addCalendarDays(date,days){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return '';const d=new Date(`${date}T12:00:00Z`);if(Number.isNaN(d.getTime()))return '';d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
  function scheduledDates(completionDate,sent={}){return STAGES.map((stage,index)=>({key:stage.key,label:stage.label,due:index===0?addCalendarDays(completionDate,stage.delay):sent[STAGES[index-1].key]?addCalendarDays(String(sent[STAGES[index-1].key]).slice(0,10),stage.delay):''}))}
  if(typeof module!=='undefined'&&module.exports){module.exports={STAGES,DEFAULT_TEMPLATES,addCalendarDays,scheduledDates};if(typeof document==='undefined')return}

  const safe=value=>typeof esc==='function'?esc(String(value??'')):String(value??'');
  const currency=documentRow=>documentRow.currency==='AED'?'AED':'INR';
  const balance=documentRow=>Math.max(0,Number(totals(documentRow)?.balance||0));
  const norm=value=>String(value||'').trim().toLocaleLowerCase();
  const parseDate=date=>date?new Date(`${date}T12:00:00`):null;
  const showDate=date=>date?parseDate(date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}):'Not set';
  const rowFor=id=>db.documents.find(item=>item.id===id);
  const clientFor=documentRow=>db.clients.find(client=>documentRow.client?.id&&client.id===documentRow.client.id)||db.clients.find(client=>norm(client.name)===norm(documentRow.client?.name));
  function inferredCompletionDate(documentRow){
    const saved=documentRow.paymentReminder?.completionDate;
    if(saved)return saved;
    const client=clientFor(documentRow),projectRows=(db.projects||[]).filter(project=>(client&&project.clientId===client.id)||norm(project.clientName)===norm(documentRow.client?.name));
    const wanted=new Set([documentRow.project,...(documentRow.items||[]).map(item=>item.name)].map(norm).filter(Boolean));
    const candidates=[];
    for(const project of projectRows){
      if(project.completedAt)candidates.push(String(project.completedAt).slice(0,10));
      for(const task of project.tasks||[]){
        const matches=!wanted.size||wanted.has(norm(task.title))||wanted.has(norm(project.name));
        if(task.done&&matches&&task.completedAt)candidates.push(String(task.completedAt).slice(0,10));
      }
      if(project.tasks?.length&&project.tasks.every(task=>task.done)&&(!wanted.size||wanted.has(norm(project.name)))){
        const latest=project.tasks.map(task=>String(task.completedAt||'').slice(0,10)).filter(Boolean).sort().at(-1);
        if(latest)candidates.push(latest);
      }
    }
    return candidates.filter(date=>/^\d{4}-\d{2}-\d{2}$/.test(date)).sort().at(-1)||'';
  }
  function pendingRows(){
    const documents=db.documents||[],activeInvoices=documents.filter(item=>item.type==='Invoice'&&!['Cancelled','Draft'].includes(item.status));
    const proformaAlreadyInvoiced=proforma=>activeInvoices.some(invoice=>invoice.sourceId===proforma.id||invoice.rootId===proforma.id);
    return documents.filter(documentRow=>['Invoice','Proforma'].includes(documentRow.type)&&!['Cancelled','Draft'].includes(documentRow.status)&&balance(documentRow)>0&&!(documentRow.type==='Proforma'&&proformaAlreadyInvoiced(documentRow)))
      .map(documentRow=>({documentRow,completionDate:inferredCompletionDate(documentRow)}))
      .sort((a,b)=>String(a.documentRow.due||'').localeCompare(String(b.documentRow.due||'')));
  }
  function ensureReminder(documentRow){if(!documentRow.paymentReminder||typeof documentRow.paymentReminder!=='object')documentRow.paymentReminder={completionDate:inferredCompletionDate(documentRow),sent:{}};if(!documentRow.paymentReminder.sent)documentRow.paymentReminder.sent={};if(!documentRow.paymentReminder.content)documentRow.paymentReminder.content={};return documentRow.paymentReminder}
  function templateFor(stage,documentRow){return documentRow?.paymentReminder?.content?.[stage]||db.settings?.paymentReminderTemplates?.[stage]||DEFAULT_TEMPLATES[stage]}
  function renderTemplate(source,documentRow,stage){
    const project=documentRow.project||documentRow.items?.map(item=>item.name).filter(Boolean).join(', ')||'the agreed services';
    const values={client:documentRow.client?.name||'Client',invoice:documentRow.number||'document',project,amount:typeof fmt==='function'?fmt(documentRow,balance(documentRow)):`${currency(documentRow)} ${balance(documentRow).toLocaleString('en-IN')}`,due_date:showDate(documentRow.due),stage:STAGES.find(item=>item.key===stage)?.label||stage,company:db.settings?.businessName||db.settings?.name||"Eric's Designs",reminder_date:showDate(today())};
    return String(source||'').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi,(match,key)=>values[key.toLowerCase()]??match);
  }
  function datesAndNext(documentRow){
    const reminder=documentRow.paymentReminder||{completionDate:inferredCompletionDate(documentRow),sent:{}},dates=scheduledDates(reminder.completionDate,reminder.sent||{});
    const next=dates.find(item=>!reminder.sent[item.key]);
    return {reminder,dates,next,due:next?.due||''};
  }
  function stageStatus(stage,dates,reminder){
    if(reminder.sent[stage.key])return `Recorded sent ${showDate(String(reminder.sent[stage.key]).slice(0,10))}`;
    if(!dates[0]?.due)return 'Set work completion date to schedule';
    const previousIndex=STAGES.findIndex(item=>item.key===stage.key)-1;
    if(previousIndex>=0&&!reminder.sent[STAGES[previousIndex].key])return `After ${STAGES[previousIndex].label.toLowerCase()}`;
    const due=dates.find(item=>item.key===stage.key)?.due;
    return due&&due<=today()?'Ready to send':`Scheduled ${showDate(due)}`;
  }
  function reminderRow({documentRow,completionDate},index){
    const {reminder,dates,next,due}=datesAndNext(documentRow),isInvoice=documentRow.type==='Invoice',remaining=balance(documentRow),client=documentRow.client?.name||'Client';
    const stageCards=STAGES.map(stage=>{const isSent=Boolean(reminder.sent[stage.key]),canSend=!isSent&&next?.key===stage.key&&due&&due<=today();return `<div class="payment-reminder-stage ${isSent?'is-sent':''}"><div><b>${safe(stage.label)}</b><small>${safe(stageStatus(stage,dates,reminder))}</small></div><div class="payment-reminder-actions"><button class="smallbtn" onclick="editPaymentReminderContent('${safe(documentRow.id)}','${stage.key}')">Edit content / PDF</button>${canSend?`<button class="smallbtn primary" onclick="recordPaymentReminderSent('${safe(documentRow.id)}','${stage.key}')">Record as sent</button>`:''}</div></div>`}).join('');
    const nextLabel=next?`${next.label}${due?` · ${showDate(due)}`:''}`:'All reminder stages recorded';
    return `<article class="panel payment-reminder-card"><div class="payment-reminder-card-head"><div><span class="badge ${isInvoice?'Sent':'Accepted'}">${isInvoice?'Final invoice':'Proforma advance'}</span><h3>${safe(client)}</h3><p class="sub">${safe(documentRow.number)} · ${safe(documentRow.project||documentRow.items?.map(item=>item.name).filter(Boolean).join(', ')||'Services')} · Invoice due ${showDate(documentRow.due)}</p></div><div class="payment-reminder-balance"><strong>${typeof fmt==='function'?safe(fmt(documentRow,remaining)):`${currency(documentRow)} ${remaining.toLocaleString('en-IN')}`}</strong><small>Balance outstanding</small><button class="smallbtn" onclick="${isInvoice?`openInvoiceFromAccount('${safe(documentRow.id)}')`:`openDoc('${safe(documentRow.id)}')`}">Open ${isInvoice?'invoice':'proforma'}</button></div></div><div class="payment-reminder-completion"><div><b>Work completion</b><small>${completionDate?`Stage 1 scheduled from ${showDate(completionDate)}`:'Add the date work was completed to schedule reminders.'}</small></div><button class="smallbtn" onclick="editPaymentReminderDate('${safe(documentRow.id)}')">${completionDate?'Change date':'Set completion date'}</button></div><div class="payment-reminder-next"><span>Next action</span><b>${safe(nextLabel)}</b></div><div class="payment-reminder-stages">${stageCards}</div></article>`;
  }
  function paymentReminderWorkspace(){
    const rows=pendingRows(),totalsByCurrency={};rows.forEach(({documentRow})=>{const cur=currency(documentRow);totalsByCurrency[cur]=(totalsByCurrency[cur]||0)+balance(documentRow)});
    const totalsText=Object.entries(totalsByCurrency).map(([cur,value])=>`${cur} ${value.toLocaleString('en-IN',{maximumFractionDigits:2})}`).join(' · ')||'—';
    const list=rows.length?rows.map(reminderRow).join(''):`<section class="panel empty"><h2>No pending client payments</h2><p>Unpaid final invoices and proforma advances will appear here automatically.</p></section>`;
    return pageHeader('Payment reminders',`<button onclick="nav('Accounts')">← Accounts</button><button class="primary" onclick="document.getElementById('payment-reminder-guide').scrollIntoView({behavior:'smooth'})">Reminder schedule</button>`,'Prepare editable PDF notices for unpaid final invoices and proforma advances. PDFs do not send automatically.')+`<div class="stats three"><div class="stat"><span>Pending documents</span><strong>${rows.length}</strong><small>Invoices and proforma advances</small></div><div class="stat"><span>Outstanding amount</span><strong>${safe(totalsText)}</strong><small>Shown by document currency</small></div><div class="stat"><span>Reminder stages</span><strong>4</strong><small>3 reminders, then a final notice</small></div></div><section class="panel payment-reminder-guide" id="payment-reminder-guide"><div class="eyebrow">FOLLOW-UP TIMING</div><h2>One clear reminder sequence</h2><div class="payment-reminder-timeline">${STAGES.map((stage,index)=>`<div><span>${index+1}</span><b>${safe(stage.label)}</b><small>${index===0?'3 days after work completion':index===3?'1 day after the third reminder':'3 days after the previous reminder'}</small></div>`).join('')}</div><p class="hint">Set or confirm each document’s work completion date. Edit the wording and generate a PDF for any stage. After you send it outside the CRM, choose “Record as sent” when that stage is due. Linked proformas are hidden once a final invoice has been issued, to avoid duplicate reminders. The final notice wording is editable and refers to contract terms; the CRM does not terminate a contract or revoke services.</p></section><section class="payment-reminder-list"><div class="dialog-title"><div><div class="eyebrow">OPEN BALANCES</div><h2>Pending invoices and payments</h2></div><span class="sub">${rows.length} document${rows.length===1?'':'s'}</span></div>${list}</section>`;
  }

  window.editPaymentReminderDate=function(id){const documentRow=rowFor(id);if(!documentRow)return;const current=inferredCompletionDate(documentRow);modal('Set work completion date',`<p class="sub full">Stage 1 will be scheduled three days after this date. This date is used for reminders only; it does not change invoice terms or project records.</p>${field('Work completion date','payment-reminder-completion-date',current,'date','required')}`,()=>{const date=val('payment-reminder-completion-date');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){document.getElementById('recordError').textContent='Choose the date the work was completed.';return}if(commitChange(()=>{ensureReminder(documentRow).completionDate=date},`Set reminder completion date for ${documentRow.number}`))closeSaved()})};
  window.editPaymentReminderContent=function(id,stage){const documentRow=rowFor(id);if(!documentRow||!STAGES.some(item=>item.key===stage))return;const text=templateFor(stage,documentRow),label=STAGES.find(item=>item.key===stage).label;modal(`Edit ${label} content`,`<p class="sub full">Edit the wording for ${safe(documentRow.number)}. Placeholders such as {{client}}, {{amount}}, and {{invoice}} are filled for this document when the PDF is created. Generating a PDF does not mark it as sent.</p><div class="field full"><label for="payment-reminder-content">Reminder content</label><textarea id="payment-reminder-content" rows="14" style="min-height:280px">${safe(text)}</textarea></div><label class="checkline full"><input id="payment-reminder-save-template" type="checkbox"> Use this wording as the default for future ${safe(label.toLowerCase())} notices</label><div class="full actions"><button type="button" class="primary" onclick="generatePaymentReminderPdfFromEditor('${safe(id)}','${stage}')">Generate PDF</button></div>`,()=>{const content=document.getElementById('payment-reminder-content')?.value||'';if(!content.trim()){document.getElementById('recordError').textContent='Add reminder content before saving.';return}const saveDefault=document.getElementById('payment-reminder-save-template')?.checked;if(commitChange(()=>{ensureReminder(documentRow).content[stage]=content;if(saveDefault){db.settings.paymentReminderTemplates=db.settings.paymentReminderTemplates||{};db.settings.paymentReminderTemplates[stage]=content}},`${saveDefault?'Saved default and document wording for':'Saved document wording for'} ${label.toLowerCase()}`))closeSaved()})};
  window.generatePaymentReminderPdfFromEditor=async function(id,stage){const documentRow=rowFor(id),content=document.getElementById('payment-reminder-content')?.value||'';if(!documentRow||!content.trim())return toast('Add reminder content before generating the PDF.');await generatePaymentReminderPdf(documentRow,stage,content)};
  window.generatePaymentReminderPdf=async function(documentRowOrId,stage,content){
    const documentRow=typeof documentRowOrId==='string'?rowFor(documentRowOrId):documentRowOrId;if(!documentRow||!STAGES.some(item=>item.key===stage))return;
    const jsPDF=window.jspdf?.jsPDF;if(!jsPDF){toast('The PDF tool is still loading. Try again in a moment.');return}
    try{const pdf=new jsPDF({unit:'mm',format:'a4'}),pageWidth=210,margin=20,width=pageWidth-margin*2,company=db.settings?.businessName||db.settings?.name||"Eric's Designs",title=STAGES.find(item=>item.key===stage).label.toUpperCase(),filledContent=renderTemplate(content,documentRow,stage);pdf.setFillColor(18,27,45);pdf.rect(0,0,pageWidth,43,'F');pdf.setTextColor(93,196,255);pdf.setFont('helvetica','bold');pdf.setFontSize(10);pdf.text(company,margin,16);pdf.setTextColor(255,255,255);pdf.setFontSize(18);pdf.text(stage==='final'?'FINAL PAYMENT NOTICE':'PAYMENT REMINDER',margin,28);pdf.setFontSize(9);pdf.setTextColor(205,216,232);pdf.text(`${title}  ·  ${documentRow.number||''}`,margin,36);pdf.setTextColor(25,35,50);pdf.setFont('helvetica','normal');pdf.setFontSize(10);const details=[`Client: ${documentRow.client?.name||'Client'}`,`Document: ${documentRow.number||''} (${documentRow.type==='Proforma'?'Proforma advance':'Final invoice'})`,`Project / service: ${documentRow.project||documentRow.items?.map(item=>item.name).filter(Boolean).join(', ')||'Services'}`,`Due date: ${showDate(documentRow.due)}`,`Outstanding balance: ${typeof fmt==='function'?fmt(documentRow,balance(documentRow)):`${currency(documentRow)} ${balance(documentRow).toLocaleString('en-IN')}`}`,`Notice date: ${showDate(today())}`];let y=56;details.forEach(line=>{const wrapped=pdf.splitTextToSize(line,width);pdf.text(wrapped,margin,y);y+=wrapped.length*5+2});y+=6;pdf.setDrawColor(205,216,232);pdf.line(margin,y,pageWidth-margin,y);y+=10;const body=pdf.splitTextToSize(String(filledContent).replace(/₹/g,'INR '),width);for(const line of body){if(y>276){pdf.addPage();y=20}pdf.text(line,margin,y);y+=5.2}pdf.save(`${documentRow.number||'invoice'}-${stage}-payment-reminder.pdf`);toast('Reminder PDF downloaded. It has not been marked as sent.')}catch(error){console.error('Payment reminder PDF failed',error);toast('Could not create the PDF. Please try again.')}};
  window.recordPaymentReminderSent=function(id,stage){const documentRow=rowFor(id);if(!documentRow||!STAGES.some(item=>item.key===stage))return;const {next,due}=datesAndNext(documentRow);if(next?.key!==stage||!due||due>today())return toast('This stage is not due yet.');const label=STAGES.find(item=>item.key===stage).label;if(!confirm(`Record the ${label.toLowerCase()} for ${documentRow.number} as sent today? This only updates the reminder history; it does not send an email.`))return;commitChange(()=>{ensureReminder(documentRow).sent[stage]=today()},`Recorded ${label.toLowerCase()} as sent for ${documentRow.number}`)};

  const accountBeforeReminders=accounts;
  accounts=function(){const page=accountBeforeReminders();const callToAction=`<section class="panel payment-reminder-entry"><div><div class="eyebrow">CLIENT COLLECTIONS</div><h2>Payment reminders</h2><p class="sub">Prepare staged PDF reminders for unpaid invoices and proforma advances.</p></div><button class="primary" onclick="nav('Payment reminders')">Open reminders →</button></section>`;return page.replace('</header>',`</header>${callToAction}`)};
  const renderBeforeReminders=render;
  render=function(){renderBeforeReminders();if(view==='Payment reminders'){const app=document.getElementById('app');if(app)app.innerHTML=paymentReminderWorkspace()}};
})();
