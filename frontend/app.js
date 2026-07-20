const STORAGE_KEY = 'shop-data-v2';
let state = { products: [], clients: [] };
let view = 'home';
let currentClientId = null;
let staged = [];
let draftItems = [];
let counter = 1;

function newId(){ return 'id' + Date.now() + '_' + (counter++); }
function normalizeAr(s){ return (s||'').replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/\s+/g,' ').trim(); }
function fmt(n){ return (Math.round((n||0)*100)/100).toLocaleString('ar-EG',{minimumFractionDigits:0,maximumFractionDigits:2}); }
function esc(s){ return (s??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function showToast(msg){ const t=document.getElementById('toast'); t.textContent=msg; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); }

function getPin(){ return localStorage.getItem('app_pin') || ''; }
function setPinPrompt(){
  const p = prompt('اكتب كلمة السر (اختياري - اسيبها فاضية لو مفيش PIN محدد):', getPin());
  if(p!==null){ localStorage.setItem('app_pin', p.trim()); loadState(); }
}

// طبقة الاتصال بالـ API — بتتكلم مع الجداول الحقيقية في قاعدة البيانات
async function apiFetch(path, method, body){
  const headers = Object.assign(
    method && method!=='GET' ? {'Content-Type':'application/json'} : {},
    getPin() ? {'x-app-pin': getPin()} : {}
  );
  const res = await fetch('/api/' + path, {
    method: method || 'GET',
    headers,
    body: body!==undefined ? JSON.stringify(body) : undefined
  });
  if(res.status === 401){
    showToast('كلمة السر غلط - دوس على ⚙️ فوق وصححها');
    throw new Error('unauthorized');
  }
  const json = await res.json().catch(()=>({}));
  if(!res.ok){
    showToast('فشل تحميل السيرفر: ' + (json.message || json.error || 'خطأ غير معروف'));
    throw new Error(json.error || 'server error');
  }
  return json;
}

async function loadState(){
  try{
    const json = await apiFetch('state', 'GET');
    state = json.data && json.data.products ? json.data : { products:[], clients:[] };
  }catch(e){
    state = { products:[], clients:[] };
  }
  render();
}

function getClient(id){ return state.clients.find(c=>c.id===id); }
function productName(id){ const p=state.products.find(p=>p.id===id); return p?p.name:null; }
function productById(id){ return state.products.find(p=>p.id===id); }

function clientBalance(client){
  const inv = client.invoices.reduce((s,i)=>s+i.total,0);
  const pay = client.payments.reduce((s,p)=>s+p.amount,0);
  return Math.round((inv-pay)*100)/100;
}

/* ---------- parsing ---------- */
function stripWhatsappPrefix(line){
  const re = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\]?\s*-?\s*[^:]{1,40}:\s*/;
  const m = line.match(re);
  return m ? line.slice(m[0].length) : line;
}
function matchProductInContent(content){
  const norm = normalizeAr(content);
  if(!norm) return null;
  let best=null, bestLen=0;
  for(const p of state.products){
    const pn = normalizeAr(p.name);
    if(pn && norm.includes(pn) && pn.length > bestLen){ best = p; bestLen = pn.length; }
  }
  return best;
}
function extractQuantityForProduct(content, product){
  const numbers = content.match(/\d+(?:\.\d+)?/g) || [];
  const productNumbers = (product.name.match(/\d+(?:\.\d+)?/g) || []).slice();
  for(const n of numbers){
    const idx = productNumbers.indexOf(n);
    if(idx !== -1){ productNumbers.splice(idx,1); continue; } // this number belongs to the product's own name (e.g. the "8" in "8ك")
    return parseFloat(n);
  }
  return 1;
}
function extractQuantityFallback(content){
  const re = /\d+/g; let m;
  while((m = re.exec(content))){
    const end = m.index + m[0].length;
    const nextChar = content[end] || '';
    if(/[كجغ]/.test(nextChar)) continue;
    return parseInt(m[0],10);
  }
  return 1;
}
function parseMessages(text){
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  const paymentKeywords = /(بعت|حولت|دفعت|ارسلت|أرسلت|استلمت)/;
  const out=[];
  for(let raw of lines){
    let content = stripWhatsappPrefix(raw).trim();
    if(!content || /<Media omitted>|omitted/i.test(content)) continue;
    if(paymentKeywords.test(content) && /\d/.test(content)){
      const numMatch = content.match(/(\d+(?:\.\d+)?)/);
      const amount = numMatch?parseFloat(numMatch[1]):0;
      out.push({id:newId(), type:'payment', amount, note:content, productId:null, quantity:null, unitPrice:null});
      continue;
    }
    const product = matchProductInContent(content);
    if(product){
      const quantity = extractQuantityForProduct(content, product);
      const amount = Math.round(quantity*product.price*100)/100;
      out.push({id:newId(), type:'item', productId:product.id, quantity, unitPrice:product.price, amount, note:content});
    } else {
      const quantity = extractQuantityFallback(content);
      out.push({id:newId(), type:'unclear', amount:0, note:content, productId:null, quantity, unitPrice:null});
    }
  }
  return out;
}

/* ---------- products ---------- */
async function addProduct(){
  try{
    const json = await apiFetch('products', 'POST', { name:'صنف جديد', price:0 });
    state.products.push(json.product);
    render();
  }catch(e){}
}
async function updateProduct(id, field, value){
  const p = state.products.find(p=>p.id===id); if(!p) return;
  const newValue = field==='price' ? (parseFloat(value)||0) : value;
  p[field] = newValue; // تحديث فوري في الواجهة
  try{
    await apiFetch('products/'+id, 'PUT', { [field]: newValue });
  }catch(e){}
}
async function deleteProduct(id){
  try{
    await apiFetch('products/'+id, 'DELETE');
    state.products = state.products.filter(p=>p.id!==id);
    render();
  }catch(e){}
}

/* ---------- clients ---------- */
async function addClient(){
  const input = document.getElementById('newClientName');
  const name = input.value.trim();
  if(!name){ showToast('اكتب اسم العميل الأول'); return; }
  try{
    const json = await apiFetch('clients', 'POST', { name });
    state.clients.push(json.client);
    input.value='';
    render();
  }catch(e){}
}
async function deleteClient(id){
  if(!confirm('هل تريد حذف هذا العميل وكل سجله؟ لا يمكن التراجع.')) return;
  try{
    await apiFetch('clients/'+id, 'DELETE');
    state.clients = state.clients.filter(c=>c.id!==id);
    render();
  }catch(e){}
}
function openClient(id){ currentClientId=id; view='client'; staged=[]; draftItems=[]; render(); }
function goHome(){ view='home'; currentClientId=null; staged=[]; draftItems=[]; render(); }
async function renameClient(id, value){
  const c = getClient(id); if(!c) return;
  const name = value.trim() || c.name;
  c.name = name;
  try{
    await apiFetch('clients/'+id, 'PUT', { name });
  }catch(e){}
  renderClientView();
}

/* ---------- invoice creation (parse) ---------- */
function doParse(){
  const text = document.getElementById('pasteArea').value;
  if(!text.trim()){ showToast('الصق الرسايل الأول'); return; }
  staged = parseMessages(text);
  renderStaged();
}
function handleFile(evt){
  const file = evt.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = () => { document.getElementById('pasteArea').value = reader.result; showToast('اتحمّل الملف، دوس "تحليل الرسايل"'); };
  reader.readAsText(file, 'UTF-8');
}
function updateStagedField(id, field, value){
  const item = staged.find(s=>s.id===id); if(!item) return;
  if(field==='type') item.type = value;
  if(field==='productId'){
    item.productId = value || null;
    const p = productById(item.productId);
    if(p){ item.unitPrice = p.price; item.amount = Math.round((item.quantity||1)*p.price*100)/100; }
  }
  if(field==='quantity'){
    item.quantity = value===''?1:parseFloat(value);
    if(item.productId){ const p=productById(item.productId); if(p) item.amount = Math.round(item.quantity*p.price*100)/100; }
  }
  if(field==='amount') item.amount = parseFloat(value)||0;
}
async function confirmStaged(){
  const client = getClient(currentClientId); if(!client) return;
  const items = staged.filter(s=>s.type==='item' && s.productId);
  const payments = staged.filter(s=>s.type==='payment');
  if(!items.length && !payments.length){ showToast('مفيش عناصر جاهزة للإضافة'); return; }
  try{
    if(items.length){
      const invItems = items.map(s=>({productId:s.productId, quantity:s.quantity}));
      const rawText = items.map(s=>s.note).join('\n');
      const json = await apiFetch('clients/'+client.id+'/invoices', 'POST', { items: invItems, rawText });
      client.invoices.push(json.invoice);
    }
    for(const p of payments){
      const json = await apiFetch('clients/'+client.id+'/payments', 'POST', { amount: p.amount, note: p.note });
      client.payments.push(json.payment);
    }
    staged=[];
    document.getElementById('pasteArea').value='';
    renderClientView();
    showToast('تم تسجيل العملية');
  }catch(e){}
}
function discardStaged(){ staged=[]; renderStaged(); }

/* ---------- manual draft invoice ---------- */
function addDraftItem(){
  const productId = document.getElementById('draftProduct').value;
  const qty = parseFloat(document.getElementById('draftQty').value)||1;
  if(!productId){ showToast('اختار صنف'); return; }
  draftItems.push({id:newId(), productId, quantity:qty});
  document.getElementById('draftQty').value='';
  renderDraft();
}
function removeDraftItem(id){ draftItems = draftItems.filter(d=>d.id!==id); renderDraft(); }
async function saveDraftInvoice(){
  if(!draftItems.length){ showToast('ضيف صنف الأول'); return; }
  const client = getClient(currentClientId); if(!client) return;
  try{
    const invItems = draftItems.map(d=>({productId:d.productId, quantity:d.quantity}));
    const json = await apiFetch('clients/'+client.id+'/invoices', 'POST', { items: invItems, rawText: 'إضافة يدوية' });
    client.invoices.push(json.invoice);
    draftItems=[];
    renderClientView();
    showToast('اتحفظت الفاتورة');
  }catch(e){}
}

/* ---------- payments ---------- */
async function addPayment(){
  const amount = parseFloat(document.getElementById('payAmount').value)||0;
  const note = document.getElementById('payNote').value;
  if(amount<=0){ showToast('اكتب مبلغ صحيح'); return; }
  const client = getClient(currentClientId); if(!client) return;
  try{
    const json = await apiFetch('clients/'+client.id+'/payments', 'POST', { amount, note });
    client.payments.push(json.payment);
    document.getElementById('payAmount').value=''; document.getElementById('payNote').value='';
    renderClientView();
    showToast('اتسجلت الدفعة');
  }catch(e){}
}
async function deleteInvoice(id){
  const client = getClient(currentClientId); if(!client) return;
  try{
    await apiFetch('invoices/'+id, 'DELETE');
    client.invoices = client.invoices.filter(i=>i.id!==id);
    renderClientView();
  }catch(e){}
}
async function deletePayment(id){
  const client = getClient(currentClientId); if(!client) return;
  try{
    await apiFetch('payments/'+id, 'DELETE');
    client.payments = client.payments.filter(p=>p.id!==id);
    renderClientView();
  }catch(e){}
}

/* ---------- export ---------- */
function clientTimelineRows(client){
  const events = [
    ...client.invoices.map(i=>({date:i.date, type:'invoice', ref:i})),
    ...client.payments.map(p=>({date:p.date, type:'payment', ref:p})),
  ].sort((a,b)=> new Date(a.date)-new Date(b.date));
  let running=0; const rows=[];
  for(const e of events){
    if(e.type==='invoice'){ running += e.ref.total; rows.push({date:e.date, نوع:'فاتورة', البيان:e.ref.items.map(i=>i.productName+' x'+i.quantity).join('، '), القيمة:e.ref.total, الرصيد:Math.round(running*100)/100}); }
    else { running -= e.ref.amount; rows.push({date:e.date, نوع:'دفعة', البيان:e.ref.note||'', القيمة:-e.ref.amount, الرصيد:Math.round(running*100)/100}); }
  }
  return rows;
}
function exportClient(clientId){
  const client = getClient(clientId); if(!client) return;
  const wb = XLSX.utils.book_new();
  const rows = clientTimelineRows(client).map((r,i)=>({'#':i+1,'التاريخ':new Date(r.date).toLocaleString('ar-EG'),'النوع':r['نوع'],'البيان':r['البيان'],'القيمة':r['القيمة'],'الرصيد بعد العملية':r['الرصيد']}));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols']=[{wch:4},{wch:20},{wch:8},{wch:38},{wch:10},{wch:14}];
  XLSX.utils.book_append_sheet(wb, ws, 'كشف الحساب');
  const itemRows=[];
  client.invoices.forEach(inv=> inv.items.forEach(it=> itemRows.push({'تاريخ الفاتورة':new Date(inv.date).toLocaleString('ar-EG'),'الصنف':it.productName,'الكمية':it.quantity,'سعر الوحدة':it.unitPrice,'الإجمالي':it.subtotal})));
  if(itemRows.length){ const ws2=XLSX.utils.json_to_sheet(itemRows); ws2['!cols']=[{wch:20},{wch:18},{wch:8},{wch:10},{wch:10}]; XLSX.utils.book_append_sheet(wb, ws2, 'تفاصيل الفواتير'); }
  XLSX.writeFile(wb, 'حساب_' + client.name.replace(/[\\\/\?\*\[\]:"<>|]/g,'_') + '.xlsx');
  showToast('اتصدّر ملف الإكسيل');
}
function exportAll(){
  if(!state.clients.length){ showToast('مفيش عملاء لتصديرهم'); return; }
  const wb = XLSX.utils.book_new();
  const summary = state.clients.map(c=>({'العميل':c.name,'الرصيد':clientBalance(c)}));
  const wsS = XLSX.utils.json_to_sheet(summary); wsS['!cols']=[{wch:22},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsS, 'ملخص العملاء');
  const usedNames = new Set();
  for(const c of state.clients){
    const rows = clientTimelineRows(c).map((r,i)=>({'#':i+1,'التاريخ':new Date(r.date).toLocaleString('ar-EG'),'النوع':r['نوع'],'البيان':r['البيان'],'القيمة':r['القيمة'],'الرصيد':r['الرصيد']}));
    const ws = XLSX.utils.json_to_sheet(rows.length?rows:[{'#':'','التاريخ':'لا يوجد عمليات'}]);
    let base = c.name.replace(/[\\\/\?\*\[\]:]/g,'').slice(0,28) || 'عميل';
    let sheetName = base, n = 2;
    while(usedNames.has(sheetName)){ sheetName = (base.slice(0,25) + '_' + n); n++; }
    usedNames.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  XLSX.writeFile(wb, 'حساب_كل_العملاء.xlsx');
  showToast('اتصدّر ملف الإكسيل');
}
async function resetAll(){
  if(!confirm('هل تريد مسح كل البيانات (الأصناف والعملاء)؟ لا يمكن التراجع.')) return;
  try{
    const json = await apiFetch('reset', 'POST');
    state = json.data;
    goHome();
  }catch(e){}
}

/* ---------- render: HOME ---------- */
function render(){ view==='home' ? renderHome() : renderClientView(); }

function renderHome(){
  const app = document.getElementById('app');
  const totalOwed = state.clients.reduce((s,c)=>s+clientBalance(c),0);
  app.innerHTML = `
  <header class="top">
    <h1>دفتر حساب الجبنة</h1>
    <p>حساب كل عميل لوحده، مع سجل كامل لكل فاتورة</p>
  </header>
  <div class="receipt">
    <div class="balance-row">
      <div class="balance-main">
        <div class="label">إجمالي المطلوب من كل العملاء</div>
        <div class="amount ${totalOwed>0?'owe':(totalOwed<0?'credit':'even')}">${fmt(Math.abs(totalOwed))} ج</div>
      </div>
      <div class="mini-stats"><div><div class="n">${state.clients.length}</div><div class="l">عدد العملاء</div></div></div>
    </div>
  </div>

  <div class="card">
    <h2>الأصناف والأسعار</h2>
    <div class="products-grid" id="productsGrid"></div>
    <button class="btn btn-outline btn-sm" onclick="addProduct()">+ إضافة صنف</button>
    <div class="stage-note">اكتب اسم الصنف زي ما هتبعته في واتساب بالظبط (مثال: جبنة ثلاجة 8ك) والسعر الكلي للوحدة دي.</div>
  </div>

  <div class="card">
    <div class="top-bar"><h2 style="border:none;margin:0;">العملاء</h2>
      <button class="btn btn-credit btn-sm" onclick="exportAll()">تصدير إكسيل لكل العملاء</button>
    </div>
    <div class="client-list" id="clientList"></div>
    <div class="add-client-row">
      <input id="newClientName" placeholder="اسم عميل جديد" onkeydown="if(event.key==='Enter')addClient()">
      <button class="btn btn-cheese" onclick="addClient()">+ إضافة عميل</button>
    </div>
  </div>

  <div class="footer-note">
    <button class="btn btn-ghost btn-sm" onclick="resetAll()">مسح كل البيانات</button>
    <div style="margin-top:8px;">البيانات متزامنة على كل أجهزتك تلقائيًا</div>
  </div>
  `;
  renderProducts();
  renderClientList();
}

function renderProducts(){
  const grid = document.getElementById('productsGrid'); if(!grid) return;
  grid.innerHTML = state.products.map(p=>`
    <div class="product-row">
      <input value="${esc(p.name)}" onchange="updateProduct('${p.id}','name',this.value)">
      <div class="price-suffix"><input type="number" value="${p.price}" onchange="updateProduct('${p.id}','price',this.value)"></div>
      <button class="icon-btn" onclick="deleteProduct('${p.id}')" title="حذف">✕</button>
    </div>
  `).join('');
}
function renderClientList(){
  const list = document.getElementById('clientList'); if(!list) return;
  if(!state.clients.length){ list.innerHTML = '<div class="empty">لسه مفيش عملاء، ضيف أول عميل تحت</div>'; return; }
  list.innerHTML = state.clients.map(c=>{
    const bal = clientBalance(c);
    const cls = bal>0?'owe':(bal<0?'credit':'even');
    return `
    <div class="client-card" onclick="openClient('${c.id}')">
      <div class="client-name">${esc(c.name)}</div>
      <div style="display:flex;align-items:center;gap:14px;">
        <div class="client-bal amount ${cls}" style="font-size:15px;">${fmt(Math.abs(bal))} ج ${bal>0?'مطلوب':(bal<0?'رصيد له':'')}</div>
        <button class="icon-btn" onclick="event.stopPropagation();deleteClient('${c.id}')" title="حذف">✕</button>
      </div>
    </div>`;
  }).join('');
}

/* ---------- render: CLIENT DETAIL ---------- */
function renderClientView(){
  const app = document.getElementById('app');
  const client = getClient(currentClientId);
  if(!client){ goHome(); return; }
  const bal = clientBalance(client);
  const balClass = bal>0?'owe':(bal<0?'credit':'even');
  const balLabel = bal>0?'مطلوب من العميل':(bal<0?'رصيد زيادة للعميل':'الحساب متزن');

  app.innerHTML = `
  <div class="top-bar">
    <button class="back-btn" onclick="goHome()">→ كل العملاء</button>
    <button class="btn btn-credit btn-sm" onclick="exportClient('${client.id}')">تصدير إكسيل</button>
  </div>

  <header class="top" style="margin-top:6px;">
    <h1 style="font-size:26px;" contenteditable="true" onblur="renameClient('${client.id}', this.textContent)">${esc(client.name)}</h1>
  </header>

  <div class="receipt">
    <div class="balance-row">
      <div class="balance-main">
        <div class="label">${balLabel}</div>
        <div class="amount ${balClass}">${fmt(Math.abs(bal))} ج</div>
      </div>
      <div class="mini-stats">
        <div><div class="n" style="color:var(--debit)">${fmt(client.invoices.reduce((s,i)=>s+i.total,0))}</div><div class="l">إجمالي الفواتير</div></div>
        <div><div class="n" style="color:var(--credit)">${fmt(client.payments.reduce((s,p)=>s+p.amount,0))}</div><div class="l">إجمالي المدفوع</div></div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>فاتورة جديدة من رسايل واتساب</h2>
    <textarea id="pasteArea" placeholder="الصق رسايل الواتساب هنا، كل صنف في سطر...&#10;مثال:&#10;2 ثلاجة 8ك&#10;كيري 1ك&#10;بعتلك 300 جنيه"></textarea>
    <div class="row-actions">
      <button class="btn btn-cheese" onclick="doParse()">تحليل الرسايل</button>
      <label class="file-label">📄 رفع ملف تصدير الشات (.txt)
        <input type="file" accept=".txt" onchange="handleFile(event)">
      </label>
    </div>
    <div id="stagedArea"></div>
  </div>

  <div class="card">
    <h2>إضافة فاتورة يدويًا</h2>
    <div class="draft-grid">
      <div><label>الصنف</label>
        <select id="draftProduct">${state.products.map(p=>`<option value="${p.id}">${esc(p.name)} — ${fmt(p.price)} ج</option>`).join('')}</select>
      </div>
      <div><label>الكمية</label><input type="number" id="draftQty" value="1" min="1"></div>
      <div><button class="btn btn-outline btn-sm" onclick="addDraftItem()">+ إضافة للفاتورة</button></div>
    </div>
    <div class="draft-list" id="draftList"></div>
  </div>

  <div class="card">
    <h2>تسجيل دفعة (خصم من الحساب)</h2>
    <div class="pay-grid">
      <div><label>المبلغ</label><input type="number" id="payAmount" placeholder="ج"></div>
      <div><label>ملاحظة</label><input type="text" id="payNote" placeholder="اختياري"></div>
      <div><button class="btn btn-credit" onclick="addPayment()">تسجيل الدفعة</button></div>
    </div>
  </div>

  <div class="card">
    <h2>سجل العميل</h2>
    <div id="historyArea"></div>
  </div>
  `;
  renderStaged();
  renderDraft();
  renderHistory();
}

function renderStaged(){
  const area = document.getElementById('stagedArea'); if(!area) return;
  if(!staged.length){ area.innerHTML=''; return; }
  area.innerHTML = `
    <div class="stage-note">راجع النتايج قبل ما تضيفها — الأصناف هتتجمع في فاتورة واحدة، والدفعات هتتسجل لوحدها:</div>
    <table>
      <tr><th>النوع</th><th>الصنف</th><th>الكمية</th><th>المبلغ</th><th>النص الأصلي</th></tr>
      ${staged.map(s=>`
        <tr>
          <td><select onchange="updateStagedField('${s.id}','type',this.value); renderStaged();">
            <option value="item" ${s.type==='item'?'selected':''}>صنف</option>
            <option value="payment" ${s.type==='payment'?'selected':''}>دفعة</option>
            <option value="unclear" ${s.type==='unclear'?'selected':''}>تجاهل</option>
          </select></td>
          <td>${s.type==='item' ? `<select onchange="updateStagedField('${s.id}','productId',this.value); renderStaged();">
              <option value="">اختر صنف</option>
              ${state.products.map(p=>`<option value="${p.id}" ${p.id===s.productId?'selected':''}>${esc(p.name)}</option>`).join('')}
            </select>` : '—'}</td>
          <td>${s.type==='item' ? `<input class="tbl-input" type="number" value="${s.quantity??1}" onchange="updateStagedField('${s.id}','quantity',this.value); renderStaged();">` : '—'}</td>
          <td><input class="tbl-input" type="number" value="${s.amount}" onchange="updateStagedField('${s.id}','amount',this.value)"></td>
          <td style="color:var(--ink-soft);font-size:12px;">${esc(s.note)}</td>
        </tr>
      `).join('')}
    </table>
    <div class="row-actions">
      <button class="btn btn-cheese" onclick="confirmStaged()">✓ تأكيد وإضافة للحساب</button>
      <button class="btn btn-ghost" onclick="discardStaged()">إلغاء</button>
    </div>
  `;
}

function renderDraft(){
  const area = document.getElementById('draftList'); if(!area) return;
  if(!draftItems.length){ area.innerHTML=''; return; }
  let total=0;
  const rows = draftItems.map(d=>{
    const p = productById(d.productId);
    const sub = (p?p.price:0)*d.quantity; total+=sub;
    return `<tr><td>${p?esc(p.name):'—'}</td><td>${d.quantity}</td><td>${fmt(sub)} ج</td>
      <td><button class="del-btn" onclick="removeDraftItem('${d.id}')">✕</button></td></tr>`;
  }).join('');
  area.innerHTML = `
    <table><tr><th>الصنف</th><th>الكمية</th><th>الإجمالي</th><th></th></tr>${rows}</table>
    <div class="row-actions">
      <div style="font-weight:700;">الإجمالي: ${fmt(total)} ج</div>
      <button class="btn btn-cheese btn-sm" onclick="saveDraftInvoice()">حفظ الفاتورة</button>
    </div>`;
}

function renderHistory(){
  const area = document.getElementById('historyArea'); if(!area) return;
  const client = getClient(currentClientId); if(!client) return;
  const events = [
    ...client.invoices.map(i=>({date:i.date, kind:'invoice', ref:i})),
    ...client.payments.map(p=>({date:p.date, kind:'payment', ref:p})),
  ].sort((a,b)=> new Date(b.date)-new Date(a.date));
  if(!events.length){ area.innerHTML = '<div class="empty">لسه مفيش فواتير أو دفعات</div>'; return; }
  area.innerHTML = events.map(e=>{
    const dt = new Date(e.date);
    const dateStr = dt.toLocaleDateString('ar-EG') + ' ' + dt.toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'});
    if(e.kind==='invoice'){
      return `<div class="invoice-card">
        <div class="invoice-head"><span class="tag item">فاتورة</span><span class="dt">${dateStr}</span></div>
        <table>${e.ref.items.map(it=>`<tr><td>${esc(it.productName)}</td><td>x${it.quantity}</td><td>${fmt(it.unitPrice)} ج</td><td>${fmt(it.subtotal)} ج</td></tr>`).join('')}</table>
        <div class="invoice-head" style="margin-top:6px;margin-bottom:0;">
          <span class="invoice-total">الإجمالي: ${fmt(e.ref.total)} ج</span>
          <button class="del-btn" onclick="deleteInvoice('${e.ref.id}')">حذف الفاتورة ✕</button>
        </div>
      </div>`;
    } else {
      return `<div class="payment-line">
        <div><span class="tag payment">دفعة</span> <span style="margin-right:8px;color:var(--ink-soft);font-size:12px;">${dateStr}</span>
          ${e.ref.note?`<div style="font-size:12.5px;color:var(--ink-soft);margin-top:4px;">${esc(e.ref.note)}</div>`:''}</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span class="amt-minus">- ${fmt(e.ref.amount)} ج</span>
          <button class="del-btn" onclick="deletePayment('${e.ref.id}')">✕</button>
        </div>
      </div>`;
    }
  }).join('');
}

loadState();
