(function(root){
'use strict';
const FORMAT={Quotation:{title:'QUOTATION',payment:false},Invoice:{title:'INVOICE',payment:true},Proforma:{title:'PROFORMA INVOICE',payment:true},Receipt:{title:'PAYMENT RECEIPT',payment:false}};
const typeOf=t=>t==='Final Invoice'?'Invoice':FORMAT[t]?t:'Quotation';
const clean=v=>String(v??'').replace(/₹/g,'INR ').replace(/[\u2013\u2014]/g,'-').replace(/[\u2018\u2019]/g,"'");
function buildPdf(doc,inputType,jsPDF,logo,qr){
 const type=typeOf(inputType||doc.type),quote=type==='Quotation',receipt=type==='Receipt',f=FORMAT[type],pdf=new jsPDF({unit:'mm',format:'a4',compress:true});
 const b=doc.business||{},client=doc.client||{},m=18,r=192,w=r-m,gold=[153,115,51],ink=[32,29,26],muted=[105,99,87];let y=20;
 const text=(v,x,yy,size=9,style='normal',align='left',color=ink)=>{pdf.setFont('times',style);pdf.setFontSize(size);pdf.setTextColor(...color);pdf.text(Array.isArray(v)?v.map(clean):clean(v),x,yy,{align,lineHeightFactor:1.15});};
 const wrap=(v,width,size=9,style='normal')=>{pdf.setFont('times',style);pdf.setFontSize(size);return pdf.splitTextToSize(clean(v),width)};
 const rule=yy=>{pdf.setDrawColor(198,185,165);pdf.setLineWidth(.2);pdf.line(m,yy,r,yy)};
 const money=v=>(doc.currency||'INR')+' '+Number(v||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
 const newPage=()=>{pdf.addPage();text(f.title+' / '+(doc.number||''),m,16,10,'bold');rule(20);y=27;};
 const ensure=h=>{if(y+h>273)newPage()};
 const paragraph=(value,width=w,size=9,style='normal',x=m,color=ink)=>{for(const line of wrap(value,width,size,style)){ensure(5);text(line,x,y,size,style,'left',color);y+=size*.405;}y+=2;};
 const heading=label=>{ensure(13);text(label,m,y,8.5,'bold','left',gold);y+=3;rule(y);y+=6;};
 if(quote){if(logo)pdf.addImage(logo,'PNG',r-19,13,10,21);text((b.name||"Eric's Designs").toUpperCase(),m,37,16,'bold');text(b.tagline||'Creative & Digital Marketing Agency',m,43,9,'italic','left',muted);text(f.title,m,54,22,'bold','left',gold);rule(64);y=71;}
 else{if(logo)pdf.addImage(logo,'PNG',m,16,16,33);text((b.name||"Eric's Designs").toUpperCase(),m+30,32,16,'bold','left',gold);text(b.tagline||'Marketing & Creative Design Studio',m+30,37,8.5,'italic','left',muted);text(f.title,r,34,type==='Proforma'?15:18,'bold','right');rule(56);y=65;}
 const left=quote?[['DATE',doc.date],['VALID UNTIL',doc.due]]:[['CLIENT',client.name],['ADDRESS',client.address],['EMAIL',client.email],['PHONE',client.phone],['CONTACT',client.contact],['GSTIN',client.gstin]];
 text(quote?'QUOTATION DETAILS':receipt?'RECEIVED FROM':'BILL TO',m,y,8,'bold','left',gold);text('DETAILS',r,y,8,'bold','right',gold);y+=6;const start=y;
 for(const [key,value] of left){if(value)paragraph(key+'  '+value,90,9,'normal',m)}
 if(quote){for(const value of [client.name,client.contact,client.address,client.email,client.phone,client.gstin].filter(Boolean))paragraph(value,90,9);}
 const leftEnd=y;y=start;for(const value of [doc.number,doc.status==='Cancelled'?'CANCELLED':null,!quote?'Date of issue: '+(doc.date||'-'):null,!quote?'Due date: '+(doc.due||'-'):null,'Currency: '+(doc.currency||'INR'),b.gstin?'GSTIN: '+b.gstin:null].filter(Boolean)){const lines=wrap(value,70,9);text(lines,r,y,9,'normal','right',muted);y+=lines.length*4+1;}
 y=Math.max(y,leftEnd)+7;
 if(doc.projectSummary||doc.project){heading('PROJECT SUMMARY');paragraph(doc.projectSummary||doc.project,w,9);y+=2;}
 const cuts=receipt?[m,55,155,r]:quote?[m,31,83,164,r]:[m,28,121,136,163,r];
 const labels=receipt?['DATE','REFERENCE / METHOD','AMOUNT']:quote?['NO.','SERVICE','DESCRIPTION','PRICE']:['#','SERVICE DESCRIPTION','QTY','RATE','AMOUNT'];
 const tableHeader=()=>{ensure(17);text(receipt?'PAYMENTS RECEIVED':quote?'SERVICES QUOTED':type==='Proforma'?'SERVICES TO BE PROVIDED':'SERVICES PROVIDED',m,y,8.5,'bold','left',gold);y+=4;pdf.setFillColor(...ink);pdf.rect(m,y,w,8,'F');labels.forEach((label,i)=>text(label,i<2||quote&&i===2?cuts[i]+2:cuts[i+1]-2,y+5.3,7,'bold',i<2||quote&&i===2?'left':'right',[255,255,255]));y+=12;};
 tableHeader();
 const rows=receipt?(doc.payments||[]).map(p=>[p.date||'-',p.reference||p.method||'Payment received',money(p.amount)]):(doc.items||[]).map((item,i)=>quote?[String(i+1).padStart(2,'0'),item.name||'-',item.description||'',item.rateText||money(item.rate)]:[String(i+1),[item.name,item.description].filter(Boolean).join('\n'),String(item.qty??1),item.rateText||money(item.rate),money(Number(item.qty??1)*Number(item.rate||0))]);
 if(!rows.length){paragraph(receipt?'No payments recorded.':'No services recorded.');}
 for(const row of rows){let cells=row.map((v,i)=>wrap(v,cuts[i+1]-cuts[i]-4,8.5,i===1?'bold':'normal'));let offset=0;const count=Math.max(...cells.map(c=>c.length));while(offset<count){if(y+8>269){newPage();tableHeader();}const take=Math.min(count-offset,Math.max(1,Math.floor((269-y-3)/3.8)));cells.forEach((lines,i)=>{const leftAlign=i<2||quote&&i===2;text(lines.slice(offset,offset+take),leftAlign?cuts[i]+2:cuts[i+1]-2,y,8.5,i===1?'bold':'normal',leftAlign?'left':'right',i===2&&quote?muted:ink)});y+=take*3.8+3;rule(y);y+=5;offset+=take;if(offset<count){newPage();tableHeader();}}}
 const subtotal=(doc.items||[]).reduce((a,i)=>a+Number(i.qty??1)*Number(i.rate||0),0),discount=subtotal*Number(doc.discount||0)/100,tax=(subtotal-discount)*Number(doc.tax||0)/100,total=subtotal-discount+tax,paid=(doc.payments||[]).reduce((a,p)=>a+Number(p.amount||0),0);
 if(quote){ensure(9);text('Tailored services are provided on request',105,y+2,10,'italic','center');y+=12;}
 else{const totals=receipt?[['PAYMENT RECEIVED',paid,true]]:[['Subtotal',subtotal],...(discount?[['Discount',-discount]]:[]),...(tax?[['GST / tax ('+Number(doc.tax)+'%)',tax]]:[]),['TOTAL DUE',total,true],...((type==='Invoice'||type==='Proforma')&&paid?[[type==='Proforma'?'Advance received':'Paid',paid],['BALANCE DUE',Math.max(0,total-paid),true]]:[])];ensure(totals.length*6+6);y+=3;for(const [label,value,bold] of totals){if(bold){pdf.setDrawColor(...gold);pdf.line(128,y-3,r,y-3)}text(label,128,y,9,bold?'bold':'normal','left',muted);text(money(value),r,y,bold?11:9,bold?'bold':'normal','right',bold?gold:ink);y+=7;}y+=5;}
 if(f.payment){const payment=[['Account Holder',b.account??'ERIC RODGERS'],['Account Number',b.accountNo??'50100486607332'],['IFSC',b.ifsc??'HDFC0000682'],['Bank / Branch',b.bank??'HDFC Bank, ALAPPUZHA'],['UPI ID',b.upi??'ericrodgers555@oksbi']].filter(([,v])=>v);if(payment.length||qr){const lines=payment.flatMap(([k,v])=>wrap(k+': '+v,118,9,'bold'));ensure(Math.max(40,lines.length*4+13));heading('PAYMENT DETAILS');const py=y;for(const line of lines){text(line,m,y,9,'bold','left',muted);y+=4;}if(qr)pdf.addImage(qr,'PNG',r-31,py-2,29,29);y=Math.max(y,py+(qr?31:0))+7;}}
 if(doc.terms){heading(receipt?'RECEIPT NOTES':'TERMS & CONDITIONS');for(const line of String(doc.terms).split(/\r?\n/).filter(s=>s.trim()))paragraph(line,w-4,9,'normal',m+2,muted);}
 ensure(22);y+=5;rule(y);y+=6;text(receipt?'Thank you for your payment.':quote?"Thank you for considering Eric's Designs.":"Thank you for choosing Eric's Designs.",quote?m:105,y,9,'italic',quote?'left':'center',muted);y+=5;if(b.email||b.phone)paragraph([b.phone,b.email].filter(Boolean).join(' | '),w,8,'normal',m,muted);
 const pages=pdf.getNumberOfPages();for(let p=1;p<=pages;p++){pdf.setPage(p);rule(282);text([b.name||"Eric's Designs",b.address].filter(Boolean).join(' - '),105,287,7,'normal','center',muted);if(pages>1)text(p+' / '+pages,r,292,7,'normal','right',muted);}
 return pdf;
}
async function asset(path){const response=await fetch(path,{cache:'no-store'});if(!response.ok)throw new Error('Document image could not be loaded. Please reload the CRM.');const blob=await response.blob();return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)})}
async function file(doc,type){const jsPDF=root.jspdf?.jsPDF||(await root.loadInvoicePdfLibrary());const [logo,qr]=await Promise.all([asset('./assets/reference-document-logo.png'),FORMAT[type].payment?asset('./assets/reference-payment-qr.png'):null]);const pdf=buildPdf(doc,type,jsPDF,logo,qr);return new File([pdf.output('blob')],(doc.number||'document').replace(/[\\/:*?"<>|]/g,'-')+'.pdf',{type:'application/pdf'})}
if(typeof module!=='undefined'&&module.exports)module.exports={buildPdf,FORMAT};
if(root?.document){root.createDocumentPdf=doc=>file(doc,typeOf(doc.type));root.createInvoicePdf=doc=>file(doc,'Invoice');root.createQuotationPdf=doc=>file(doc,'Quotation');root.createProformaPdf=doc=>file(doc,'Proforma');root.createPaymentReceiptPdf=doc=>file({...doc,type:'Receipt',terms:doc.receiptNotes||'This receipt confirms the payments listed above.',number:(doc.number||'')+' RECEIPT'},'Receipt');}
})(typeof window!=='undefined'?window:globalThis);
