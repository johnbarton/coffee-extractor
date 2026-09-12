
(async()=>{
  const root=document.getElementById('coffee-collection');
  const get=id=>root.querySelector('#'+id);
  let records=[];
  const ownerRoute=location.pathname==='/owner'||location.pathname.startsWith('/owner/');
  let owner=false;
  const state={view:'now',group:'roaster',status:'all',limit:10,expanded:null};
  const editDrafts=new Map(), revisions=new Map(), loading=new Set(), loadErrors=new Map();
  const saving=new Set(), blockedSaves=new Set(), openEditors=new Set();
  const ratingAxes=[['overall','Overall'],['florality','Floral'],['fruitiness','Fruit'],['brightness','Bright']];
  const validRating=value=>Number.isInteger(value)&&value>=1&&value<=5;
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dayValue=iso=>{if(!iso)return NaN;const [y,m,d]=iso.split('-').map(Number);return Date.UTC(y,m-1,d)/86400000;};
  const todayIso=()=>{const n=new Date();return [n.getFullYear(),String(n.getMonth()+1).padStart(2,'0'),String(n.getDate()).padStart(2,'0')].join('-');};
  let today=todayIso();
  const dateLabel=(iso,year=true)=>iso?new Date(iso+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{})}):'Not recorded';
  const age=r=>Number.isFinite(dayValue(r.roastDate))?Math.floor(dayValue(today)-dayValue(r.roastDate)):null;
  const roaster=r=>r.roaster.replace(' Coffee Roasters','');
  const statusName=s=>({active:'Open',resting:'Resting',frozen:'Frozen',finished:'Finished'}[s]||'Status not set');
  const dateOrder=(a,b)=>(b.roastDate||'').localeCompare(a.roastDate||'')||a.name.localeCompare(b.name);
  const labelValue=(key,value)=>'<dt>'+esc(key)+'</dt><dd>'+esc(value||'Not recorded')+'</dd>';
  function ratingSummary(r){
    return '<section class="cc-ratings" data-rating-id="'+esc(r.id)+'" aria-label="Ratings"><div class="cc-ratings-head"><h3>Ratings</h3><span class="cc-ratings-scale">1–5</span></div><div class="cc-rating-visual"></div><div class="cc-ratings-bottom"><p class="cc-ratings-state" role="status"></p></div></section>';
  }
  function radarMarkup(ratings,width,description){
    const radius=Math.min(84,Math.max(34,(width-130)/2));
    const cx=width/2,cy=radius+46,height=2*radius+100;
    const vectors=[[0,-1],[1,0],[0,1],[-1,0]];
    const xy=(i,value)=>[cx+vectors[i][0]*radius*value/5,cy+vectors[i][1]*radius*value/5];
    const points=values=>values.map((v,i)=>xy(i,v).join(',')).join(' ');
    let svg='<svg class="cc-radar" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" role="img" aria-label="'+esc(description)+'"><title>'+esc(description)+'</title>';
    for(let ring=1;ring<=5;ring++)svg+='<polygon class="cc-radar-ring" points="'+points([ring,ring,ring,ring])+'"/>';
    vectors.forEach((_,i)=>{const [x,y]=xy(i,5);svg+='<line class="cc-radar-axis" x1="'+cx+'" y1="'+cy+'" x2="'+x+'" y2="'+y+'"/>';});
    [1,3,5].forEach(value=>{const delta=radius*value/10;svg+='<text class="cc-radar-tick" x="'+(cx+delta+4)+'" y="'+(cy-delta-4)+'">'+value+'</text>';});
    const values=ratingAxes.map(([key])=>ratings?.[key]);
    if(values.every(validRating))svg+='<polygon class="cc-radar-profile" points="'+points(values)+'"/>';
    values.forEach((value,i)=>{if(validRating(value)){const [x,y]=xy(i,value);svg+='<circle class="cc-radar-point" cx="'+x+'" cy="'+y+'" r="3"/>';}});
    const labels=[[cx,cy-radius-26,'middle'],[cx+radius+10,cy-5,'start'],[cx,cy+radius+24,'middle'],[cx-radius-10,cy-5,'end']];
    ratingAxes.forEach(([key,label],i)=>{const [x,y,anchor]=labels[i];const value=validRating(ratings?.[key])?ratings[key]+' / 5':'—';svg+='<text x="'+x+'" y="'+y+'" text-anchor="'+anchor+'">'+label+'<tspan class="cc-radar-value" x="'+x+'" dy="17">'+value+'</tspan></text>';});
    return svg+'</svg>';
  }
  function drawRatings(){
    root.querySelectorAll('[data-rating-id]').forEach(section=>{
      const r=records.find(item=>item.id===section.dataset.ratingId);
      const ratings=r.ratings;
      const rated=ratingAxes.filter(([key])=>validRating(ratings?.[key])).length;
      const description=('Ratings for '+r.name+'. ')+'Scale 1 to 5. '+ratingAxes.map(([key,label])=>label+': '+(validRating(ratings?.[key])?ratings[key]+' out of 5':'not rated')).join('; ')+'.';
      const visual=section.querySelector('.cc-rating-visual');
      const width=visual.clientWidth;if(!width)return;
      visual.innerHTML=radarMarkup(ratings,width,description);
      section.querySelector('.cc-ratings-state').textContent=rated===0?'Not rated yet':rated<4?rated+' of 4 rated · — not rated':'All 4 rated';
    });
  }
  function detail(r){
    const freeze=(r.status==='frozen')?labelValue('Marked frozen',dateLabel(r.statusDate)):'';
    const draft=editDrafts.get(r.id)||{status:r.status||'',ratings:r.ratings,notes:''};
    const options=['','active','resting','frozen','finished'].map(s=>'<option value="'+s+'"'+(draft.status===s?' selected':'')+'>'+statusName(s)+'</option>').join('');
    const scores=ratingAxes.map(([k,label])=>'<label>'+label+'<select name="'+k+'" aria-label="'+label+' rating"><option value="">Not rated</option>'+[1,2,3,4,5].map(v=>'<option value="'+v+'"'+(draft.ratings?.[k]===v?' selected':'')+'>'+v+' / 5</option>').join('')+'</select></label>').join('');
    const components=r.isBlend?labelValue('Blend',r.blendComponents.map(c=>[c.percentage!=null?c.percentage+'%':null,c.country,c.varieties?.join(', '),c.process].filter(Boolean).join(' · ')).join('; ')):'';
    const notes=r.personalNotes?'<details><summary>Brewing notes</summary><p class="cc-notes">'+esc(r.personalNotes)+'</p></details>':'';
    const editor=owner&&revisions.has(r.id)?'<details data-edit-disclosure="'+esc(r.id)+'"'+(openEditors.has(r.id)?' open':'')+'><summary>Edit record</summary><div class="cc-editor" data-editor="'+esc(r.id)+'"><label>Bag status<select name="status">'+options+'</select></label><div class="cc-rating-fields">'+scores+'</div><label>Add brewing notes<textarea name="notes" rows="4" maxlength="8000" placeholder="Recipe, grind setting, tasting impressions…">'+esc(draft.notes)+'</textarea><span class="cc-note-hint">Added below your existing notes.</span></label><button type="button" class="cc-apply" data-apply="'+esc(r.id)+'"'+(saving.has(r.id)||blockedSaves.has(r.id)?' disabled':'')+'>'+(saving.has(r.id)?'Saving…':'Save changes')+'</button>'+(blockedSaves.has(r.id)?'<p class="cc-notice">Check the latest record before editing again. Your draft is still in the fields above.</p><button type="button" class="cc-more" data-reload="'+esc(r.id)+'">Load latest · discard draft</button>':'')+'</div></details>':owner?'<p class="cc-notice">'+esc(loadErrors.get(r.id)||'Loading latest record…')+'</p>'+(loadErrors.has(r.id)?'<button type="button" class="cc-more" data-reload="'+esc(r.id)+'">Try again</button>':''):'';
    return '<div class="cc-detail"><dl>'+labelValue('Roasted',dateLabel(r.roastDate))+labelValue('Status',statusName(r.status))+freeze+labelValue('Origin',r.countries?.join(' / '))+labelValue('Variety',r.varieties?.join(', '))+labelValue('Process',r.process)+components+labelValue('Tasting notes',r.tastingNotes?.join(' · '))+'</dl>'+ratingSummary(r)+notes+editor+'</div>';
  }
  function readEditor(editor){
    const ratings={};ratingAxes.forEach(([key])=>{const value=editor.querySelector('[name='+key+']').value;ratings[key]=value?Number(value):null;});
    return {status:editor.querySelector('[name=status]').value,ratings,notes:editor.querySelector('[name=notes]').value};
  }
  async function api(path,options={}){
    let response;
    try {
      response=await fetch('/owner/api/'+path,{credentials:'same-origin',cache:'no-store',redirect:'error',...options});
    } catch {
      const error=new Error(options.method==='PUT'?'The connection was interrupted. Your save may have completed. Check the latest record before editing again.':'Could not connect. Check your connection or sign in again.');
      error.code=options.method==='PUT'?'save_uncertain':'network';throw error;
    }
    let body;
    try {body=await response.json();}catch{const error=new Error('Please sign in again, then check the latest record.');error.code='save_uncertain';throw error;}
    if(!response.ok){const error=new Error(body.error||'Could not save this record.');error.code=body.code;throw error;}
    return body;
  }
  async function loadRecord(id){
    if(!owner||loading.has(id)||saving.has(id))return;
    loading.add(id);loadErrors.delete(id);render();
    try {
      const result=await api('coffees/'+encodeURIComponent(id));
      const record=records.find(r=>r.id===id);Object.assign(record,result.coffee);
      revisions.set(id,result.sha);
    }catch(error){loadErrors.set(id,error.message);}
    finally{loading.delete(id);render();}
  }
  async function saveRecord(r,editor){
    if(!owner||saving.has(r.id)||blockedSaves.has(r.id)||!revisions.has(r.id))return;
    const draft=readEditor(editor);editDrafts.set(r.id,draft);saving.add(r.id);
    openEditors.add(r.id);render();
    try {
      const result=await api('coffees/'+encodeURIComponent(r.id),{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({sha:revisions.get(r.id),status:draft.status||null,ratings:draft.ratings,notes:draft.notes})});
      Object.assign(r,result.coffee);revisions.set(r.id,result.sha);editDrafts.delete(r.id);
      showNotice(result.unchanged?'No changes to save.':'Saved '+r.name+'. The public collection will update after publishing.');
    }catch(error){
      if(['conflict','save_uncertain'].includes(error.code))blockedSaves.add(r.id);
      showNotice(error.message);
    }finally{saving.delete(r.id);render();}
  }
  function bag(r){
    const expanded=state.expanded===r.id&&!renderedDetails.has(r.id);
    if(expanded)renderedDetails.add(r.id);
    let side;
    if(state.view==='now')side='<span class="cc-age"><span class="cc-age-number">'+(age(r)??'—')+'</span><span class="cc-age-label">days since<br>roast</span></span>';
    else if(state.view==='frozen')side='<span class="cc-age"><span class="cc-date-large">'+esc(dateLabel(r.roastDate,false))+'</span><span class="cc-age-label">'+esc(r.roastDate?.slice(0,4)||'')+' roast</span></span>';
    else side='<span class="cc-age"><span class="cc-state '+esc(r.status||'')+'">'+statusName(r.status)+'</span>'+(r.ratings?.overall?'<span class="cc-age-label">'+r.ratings.overall+' / 5</span>':'')+'</span>';
    const meta=state.view==='now'?[r.countries?.join(' / '),r.varieties?.slice(0,2).join(' / ')].filter(Boolean).join(' · '):state.view==='frozen'?'Marked frozen '+dateLabel(r.statusDate):dateLabel(r.roastDate);
    return '<article class="cc-bag"><button type="button" class="cc-bag-button" data-bag="'+esc(r.id)+'" aria-expanded="'+expanded+'" aria-label="'+esc(roaster(r)+' '+r.name)+', details"><span><span class="cc-roaster">'+esc(roaster(r))+'</span><span class="cc-name">'+esc(r.name)+'</span>'+(state.view!=='all'&&r.tastingNotes?.length?'<span class="cc-taste">'+esc(r.tastingNotes.join(' · '))+'</span>':'')+'<span class="cc-meta">'+esc(meta)+'</span></span>'+side+'</button>'+(expanded?detail(r):'')+'</article>';
  }
  function groupKeys(r){
    if(state.group==='roaster')return [roaster(r)];
    if(state.group==='variety')return r.varieties?.length?r.varieties:['Variety not recorded'];
    if(state.group==='country')return r.countries?.length?r.countries:['Origin not recorded'];
    if(state.group==='process')return [r.process||'Process not recorded'];
    return [r.roastDate?.slice(0,4)||'Year not recorded'];
  }
  function showNotice(message){get('cc-notice').textContent=message;get('cc-notice').hidden=false;}
  let renderedDetails=new Set();
  function render(){
    renderedDetails=new Set();
    get('cc-view-label').textContent=owner?'Owner view':'Coffee collection';
    get('cc-owner-link').textContent=owner?'Sign out':'Owner sign in';
    get('cc-owner-link').href=owner?'/cdn-cgi/access/logout':'/owner';
    const active=records.filter(r=>r.status==='active'),resting=records.filter(r=>r.status==='resting'),frozen=records.filter(r=>r.status==='frozen'),unset=records.filter(r=>!r.status);
    get('cc-today').textContent=dateLabel(today,false);
    get('cc-now-count').textContent=active.length+resting.length;
    get('cc-frozen-count').textContent=frozen.length;
    get('cc-all-count').textContent=records.length;
    root.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.view===state.view));
    get('cc-heading').textContent=state.view==='now'?'On the counter':state.view==='frozen'?'The freezer':'All coffees';
    get('cc-description').textContent=state.view==='now'?active.length+' open · '+resting.length+' resting':state.view==='frozen'?'Roast dates and recorded freeze dates.':records.length+' bags · '+new Set(records.map(r=>r.roaster)).size+' roasters';
    get('cc-filters').hidden=state.view!=='all';
    get('cc-unset-wrap').hidden=state.view!=='now'||!unset.length;
    get('cc-unset-label').textContent=unset.length+' bags still need a status';
    get('cc-list').className=state.view==='all'?'cc-collection':'';
    let rows=[];
    if(state.view==='now'){
      const sections=[['Open',active],['Resting',resting]].filter(([,rs])=>rs.length);
      sections.forEach(([name,rs])=>{if(sections.length>1)rows.push('<h3 class="cc-group">'+name+'<small>'+rs.length+' bags</small></h3>');rows.push(...rs.sort(dateOrder).map(bag));});
      get('cc-more').hidden=true;
    }else if(state.view==='frozen'){
      rows=frozen.sort(dateOrder).map(bag);get('cc-more').hidden=true;
    }else{
      const selected=records.filter(r=>state.status==='all'||(state.status==='unknown'?!r.status:r.status===state.status));
      const groups=new Map();
      selected.forEach(r=>groupKeys(r).forEach(k=>{if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}));
      const keys=[...groups.keys()].sort((a,b)=>Number(a.includes('not recorded'))-Number(b.includes('not recorded'))||(state.group==='year'?b.localeCompare(a):a.localeCompare(b)));
      let count=0,total=0;
      keys.forEach(k=>{const rs=groups.get(k).sort(dateOrder);total+=rs.length;if(count>=state.limit)return;rows.push('<h3 class="cc-group">'+esc(k)+'<small>'+rs.length+(rs.length===1?' bag':' bags')+'</small></h3>');rs.forEach(r=>{if(count<state.limit){rows.push(bag(r));count++;}});});
      get('cc-more').hidden=count>=total;get('cc-more').textContent='Show more';
    }
    get('cc-list').innerHTML=rows.length?rows.join(''):'<p class="cc-empty">'+(state.view==='now'?'Your open and resting coffees will appear here.':'No coffees in this view.')+'</p>';
    root.querySelectorAll('[data-editor]').forEach(editor=>{if(saving.has(editor.dataset.editor))editor.querySelectorAll('select,textarea,button').forEach(control=>{control.disabled=true;});});
    drawRatings();
  }
  function waveArt(){
    const canvas=root.querySelector('canvas');
    const width=canvas.clientWidth,height=canvas.clientHeight;if(!width||!height)return;
    const ratio=window.devicePixelRatio||1;canvas.width=width*ratio;canvas.height=height*ratio;const ctx=canvas.getContext('2d');if(!ctx)return;ctx.scale(ratio,ratio);
    const colors=getComputedStyle(root);ctx.strokeStyle=colors.getPropertyValue('--cc-fg');ctx.lineWidth=.72;
    for(let row=0;row<21;row++){
      ctx.beginPath();
      for(let x=0;x<=width;x+=1.5){
        const t=x/width;
        const envelope=Math.exp(-Math.pow((t-.56)/.26,4));
        const peak=(11+8*Math.sin(row*.24))*Math.exp(-Math.pow((t-.45)/.18,2))+(17+6*Math.cos(row*.3))*Math.exp(-Math.pow((t-.69)/.105,2));
        const ripple=(Math.sin(t*34+row*.38)*2.2+Math.sin(t*72-row*.29)*1.1)*envelope;
        const y=35+row*4.1-peak+ripple;
        if(x===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
      }
      ctx.globalAlpha=.34+row*.026;ctx.stroke();
    }
  }
  root.addEventListener('input',event=>{const editor=event.target.closest('[data-editor]');if(editor&&owner)editDrafts.set(editor.dataset.editor,readEditor(editor));});
  root.addEventListener('click',event=>{
    const view=event.target.closest('[data-view]');
    if(view){state.view=view.dataset.view;state.expanded=null;state.limit=10;get('cc-notice').hidden=true;render();return;}
    const b=event.target.closest('[data-bag]');if(b){state.expanded=state.expanded===b.dataset.bag?null:b.dataset.bag;render();if(state.expanded&&owner&&!revisions.has(state.expanded))loadRecord(state.expanded);return;}
    const reload=event.target.closest('[data-reload]');if(reload){const id=reload.dataset.reload;editDrafts.delete(id);blockedSaves.delete(id);revisions.delete(id);loadRecord(id);return;}
    const a=event.target.closest('[data-apply]');
    if(a){
      const r=records.find(r=>r.id===a.dataset.apply),editor=a.closest('[data-editor]');
      if(r&&editor)saveRecord(r,editor);
    }
  });
  get('cc-more').addEventListener('click',()=>{state.limit+=12;render();});
  get('cc-group').addEventListener('change',event=>{state.group=event.target.value;state.limit=10;state.expanded=null;render();});
  get('cc-status').addEventListener('change',event=>{state.status=event.target.value;state.limit=10;state.expanded=null;render();});
  get('cc-unset').addEventListener('click',()=>{state.view='all';state.status='unknown';state.limit=10;state.expanded=null;get('cc-status').value='unknown';render();});
  let lastWidth=0;new ResizeObserver(()=>{const width=root.clientWidth;if(width!==lastWidth){lastWidth=width;waveArt();drawRatings();}}).observe(root);
  const refreshDay=()=>{if(!document.hidden&&today!==todayIso()){today=todayIso();render();}};
  document.addEventListener('visibilitychange',refreshDay);
  setInterval(refreshDay,60000);
  root.addEventListener('toggle',event=>{
    const id=event.target.dataset?.editDisclosure;if(!id||!root.contains(event.target))return;
    if(event.target.open)openEditors.add(id);else openEditors.delete(id);
  },true);
  window.addEventListener('beforeunload',event=>{if(editDrafts.size||saving.size){event.preventDefault();event.returnValue='';}});
  get('cc-list').innerHTML='<p class="cc-empty" role="status">Loading coffees…</p>';
  get('cc-unset-wrap').hidden=true;
  waveArt();
  try {
    const response=await fetch('__COFFEE_DATA_URL__',{cache:'no-cache'});
    if(!response.ok)throw new Error('Could not load the collection. Please reload to try again.');
    records=await response.json();
    if(ownerRoute){
      try{owner=(await api('session')).owner===true;}catch(error){showNotice(error.message);}
    }
    render();
  }catch(error){get('cc-list').innerHTML='<p class="cc-empty">'+esc(error.message)+'</p><button class="cc-more" type="button">Reload</button>';get('cc-list').querySelector('button').addEventListener('click',()=>location.reload());}
})();
