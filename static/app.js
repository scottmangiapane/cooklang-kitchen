const app = document.getElementById('app');
let recipeCache = [];
let currentRecipe = null;
let baseServings = 2;
let selectedServings = 2;
let declaredServings = false;
let originalServingLabel = '';
let checkedIngredients = new Set();

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyKey = k => String(k).replace(/[_-]+/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
const human = v => Array.isArray(v) ? v.map(human).join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
const icon = (name, cls='') => window.kitchenIcon ? window.kitchenIcon(name, cls) : '';
function recipeUrl(id){ return '#/recipe/' + encodeURIComponent(id); }
function photoUrl(id, size='detail', version=''){
  const query = new URLSearchParams({size});
  if(version) query.set('v', version);
  return '/api/photos/' + id.split('/').map(encodeURIComponent).join('/') + '?' + query.toString();
}
function tagMarkup(tags){ return (tags||[]).slice(0,6).map(t=>`<span class="tag">${icon('tag','tag-icon')}${esc(t)}</span>`).join(''); }
function goHome(){ if(location.hash !== '#/') location.hash = '/'; else loadIndex(); }

async function loadIndex(){
  app.innerHTML='<div class="loading"><span class="spinner"></span> Loading recipes…</div>';
  try{
    const response=await fetch('/api/recipes',{cache:'no-store'});
    if(!response.ok) throw new Error('HTTP '+response.status);
    const data=await response.json();
    recipeCache=data.recipes||[];
    renderHome('', data.directory_ok);
  }catch(e){
    app.innerHTML=`<div class="error-banner">Couldn't load the recipe library. ${esc(e.message)}. Check that the recipe folder is mounted and the container is running.</div>`;
  }
}

function renderHome(query='', directoryOk=true){
  const q=query.trim().toLocaleLowerCase();
  const recipes=recipeCache.filter(r=>!q || r.title.toLocaleLowerCase().includes(q) || (r.tags||[]).some(t=>t.toLocaleLowerCase().includes(q)) || r.id.toLocaleLowerCase().includes(q));
  const sort = document.getElementById('sort-order')?.value || 'title';
  recipes.sort((a,b)=> sort==='filename' ? a.id.localeCompare(b.id) : a.title.localeCompare(b.title,undefined,{sensitivity:'base'}));
  app.innerHTML=`
    ${!directoryOk?'<div class="error-banner">The configured recipes folder is not available inside the container. Verify the bind mount in compose.yaml.</div>':''}
    <section class="hero"><h1>Recipes</h1><div class="hero-count"><span class="count-number">${recipeCache.length}</span><span class="count-label">${recipeCache.length===1?'recipe':'recipes'}</span></div></section>
    <div class="search-wrap">${icon('search','search-icon')}<input class="search" id="recipe-search" type="search" placeholder="Search recipes or tags…" value="${esc(query)}" autocomplete="off" aria-label="Search recipes"><span class="shortcut" title="Press / to focus search" aria-label="Keyboard shortcut: press slash to search">/</span></div>
    <div class="toolbar"><span class="results-label" id="results-count">${recipes.length} ${recipes.length===1?'recipe':'recipes'}${q?' found':''}</span><label class="sort-label">Sort by <select id="sort-order" class="sort-select" aria-label="Sort recipes"><option value="title" ${sort==='title'?'selected':''}>Name</option><option value="filename" ${sort==='filename'?'selected':''}>File name</option></select></label></div>
    ${recipes.length?`<div class="recipe-grid">${recipes.map((r,i)=>{
      const photo = r.photo_available ? `<img class="card-photo" src="${esc(photoUrl(r.id,'card',r.photo_version))}" alt="" loading="lazy" onerror="this.remove();this.parentElement.classList.add('photo-missing')">` : '';
      return `<a class="recipe-card ${r.photo_available?'has-photo':''}" href="${recipeUrl(r.id)}"><div class="card-top ${r.photo_available?'with-photo':''}">${r.photo_available?photo:`<span class="card-icon">${icon('bookOpen')}</span>`}<span class="card-number">${String(i+1).padStart(2,'0')}</span></div><h2 class="card-title">${esc(r.title)}</h2><div class="tag-row">${tagMarkup(r.tags)}</div><div class="card-footer"><span>${icon('forkKnife')} ${r.ingredient_count||0} ingredients</span><span>${icon('list')} ${r.step_count||0} steps</span></div></a>`;
    }).join('')}</div>`:`<div class="empty"><strong>${recipeCache.length?'No matching recipes':'No recipes found'}</strong><span>${recipeCache.length?'Try another name or tag.':'Add .cook files to the mounted Recipes folder.'}</span></div>`}
  `;
  const input=document.getElementById('recipe-search');
  input.addEventListener('input', e=>{
    const value=e.target.value; const cursor=e.target.selectionStart;
    renderHome(value,directoryOk);
    const next=document.getElementById('recipe-search'); next.focus(); next.setSelectionRange(cursor,cursor);
  });
  document.getElementById('sort-order').addEventListener('change',()=>renderHome(document.getElementById('recipe-search').value,directoryOk));
}

function inlineMarkup(parts){
  return (parts||[]).map(p=>{
    if(p.type==='text') return esc(p.text).replace(/\n/g,'<br>');
    if(p.type==='ingredient') return `<span class="inline-ingredient" title="Ingredient${p.optional?' (optional)':''}">${esc(p.name)}${p.optional?' · optional':''}</span>${p.preparation?` <span class="inline-preparation">(${esc(p.preparation)})</span>`:''}`;
    if(p.type==='cookware') return `<span class="inline-cookware" title="Cookware">${esc(p.name)}</span>${p.optional?' <span class="optional">optional</span>':''}`;
    if(p.type==='timer') return `<span class="inline-timer">${icon('clock')} ${esc([p.name && p.name!=='Timer'?p.name:'',p.quantity,p.unit].filter(Boolean).join(' '))}</span>`;
    return '';
  }).join('');
}

function servingSource(meta){
  for(const key of ['servings','serves','portions','yield']){
    const value=meta?.[key];
    if(value!==undefined&&value!==null&&human(value).trim()) return {key, value, label:human(value)};
  }
  return null;
}
function parseServingNumber(value){
  const s=String(value??'').trim();
  const number='(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
  const range=new RegExp('^\\s*('+number+')\\s*(?:[-–—]|\\bto\\b)\\s*('+number+')','i').exec(s);
  const asNumber = raw => {
    const n=raw.trim(); let m;
    if((m=/^(\d+)\s+(\d+)\/(\d+)$/.exec(n))) return Number(m[1])+Number(m[2])/Number(m[3]);
    if((m=/^(\d+)\/(\d+)$/.exec(n))) return Number(m[1])/Number(m[2]);
    return Number(n);
  };
  if(range){const a=asNumber(range[1]),b=asNumber(range[2]); if(Number.isFinite(a)&&Number.isFinite(b))return (a+b)/2;}
  const first=new RegExp(number).exec(s);
  if(first){const n=asNumber(first[0]);if(Number.isFinite(n))return n;}
  return null;
}
function servingStateFor(meta){
  const source=servingSource(meta);
  if(source){
    const parsed=parseServingNumber(source.label);
    if(parsed!==null&&parsed>0){
      originalServingLabel=source.label;
      declaredServings=true;
      baseServings=Math.max(1,Math.round(parsed));
      selectedServings=baseServings;
      return;
    }
  }
  declaredServings=false;
  originalServingLabel='';
  baseServings=2;
  selectedServings=2;
}
function scaleFactor(){return selectedServings/Math.max(1,baseServings);}

function fractionValue(raw){
  const s=String(raw).trim(); let m;
  if((m=/^(\d+)\s+(\d+)\/(\d+)$/.exec(s))) return Number(m[1])+Number(m[2])/Number(m[3]);
  if((m=/^(\d+)\/(\d+)$/.exec(s))) return Number(m[1])/Number(m[2]);
  if(/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  return null;
}
function formatCulinaryNumber(value){
  if(!Number.isFinite(value)) return String(value);
  if(Math.abs(value)<0.000001) return '0';
  const whole=Math.floor(value+1e-8), frac=value-whole;
  if(frac<0.015) return String(whole);
  const denominators=[2,3,4,5,6,8,10,12,16];
  let best=null;
  for(const den of denominators){
    const num=Math.round(frac*den);const err=Math.abs(frac-num/den);
    if(!best||err<best.err)best={den,num,err};
  }
  if(best&&best.err<0.015){
    if(best.num===best.den)return String(whole+1);
    const common=(a,b)=>b?common(b,a%b):a;
    const gcd=common(best.num,best.den);const n=best.num/gcd,d=best.den/gcd;
    return (whole?whole+' ':'')+n+'/'+d;
  }
  return (Math.round(value*100)/100).toString();
}
function scaledQuantity(quantity, unit, factor){
  const q=String(quantity??'').trim(); const u=String(unit??'').trim();
  if(!q) return u;
  if(Math.abs(factor-1)<0.000001) return [q,u].filter(Boolean).join(' ');
  const number='(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?)';
  const re=new RegExp('^\\s*('+number+')(?:\\s*[-–—]\\s*('+number+'))?(.*)$');
  const m=re.exec(q);
  if(!m) return [q,u].filter(Boolean).join(' ');
  const a=fractionValue(m[1]);const b=m[2]?fractionValue(m[2]):null;
  if(a===null|| (m[2]&&b===null)) return [q,u].filter(Boolean).join(' ');
  const left=formatCulinaryNumber(a*factor);
  const amount=m[2]?`${left}–${formatCulinaryNumber(b*factor)}`:left;
  const rest=(m[3]||'').trim();
  const remaining=[rest,u].filter(Boolean).filter((v,i,a)=>i===0||v.toLowerCase()!==a[0].toLowerCase()).join(' ');
  return [amount,remaining].filter(Boolean).join(' ');
}
function itemQuantity(item,factor){return scaledQuantity(item.quantity,item.unit,factor);}

function metadataPills(meta){
  const candidates=[['author','By'],['prep_time','Prep'],['cook_time','Cook'],['total_time','Total']];
  return candidates.filter(([key])=>meta&&meta[key]!==undefined&&meta[key]!==null&&human(meta[key]).trim())
    .map(([key,label])=>`<span class="meta-pill">${esc(label)} <b>${esc(human(meta[key]))}</b></span>`).join('');
}
function metadataCards(meta){
  if(!meta||typeof meta!=='object')return '';
  const hidden=new Set(['title','tags','author','servings','serves','portions','yield','prep_time','cook_time','total_time','photo','image','photo_file','image_file']);
  const items=Object.entries(meta).filter(([k,v])=>!hidden.has(k.toLowerCase())&&v!==undefined&&v!==null&&human(v).trim());
  if(!items.length)return '';
  return `<div class="metadata-table">${items.map(([k,v])=>`<div class="metadata-item"><span class="metadata-key">${esc(prettyKey(k))}</span><div class="metadata-value">${esc(human(v))}</div></div>`).join('')}</div>`;
}
function renderComponents(items, type, factor=1){
  if(!items?.length)return `<p class="empty-list">${type==='ingredient'?'No ingredients found in the markup.':'No cookware marked in this recipe.'}</p>`;
  if(type==='ingredient') return `<ul class="ingredient-list">${items.map((it,i)=>`<li><input class="ingredient-check" type="checkbox" id="ing-${i}" data-ingredient-index="${i}" ${checkedIngredients.has(i)?'checked':''}><label for="ing-${i}" style="flex:1"><span class="ingredient-main">${itemQuantity(it,factor)?`<span class="ingredient-amount">${esc(itemQuantity(it,factor))}</span>`:''}<span class="ingredient-name">${esc(it.name)}</span>${it.optional?'<span class="optional">optional</span>':''}</span>${it.preparation?`<span class="ingredient-prep">${esc(it.preparation)}</span>`:''}</label></li>`).join('')}</ul>`;
  return `<ul class="cookware-list">${items.map(it=>`<li>${icon('cookingPot')}<span>${esc(it.name)}${it.optional?' <span class="optional">optional</span>':''}</span></li>`).join('')}</ul>`;
}
function stepIngredientMarkup(parts,factor){
  const list=[];const seen=new Set();
  for(const p of parts||[]){
    if(p.type!=='ingredient')continue;
    const key=[p.name,p.quantity,p.unit,p.preparation,p.optional].join('|').toLocaleLowerCase();
    if(seen.has(key))continue;seen.add(key);list.push(p);
  }
  if(!list.length)return '';
  return `<div class="step-ingredients" aria-label="Ingredients used in this step">${list.map(p=>{
    const amount=scaledQuantity(p.quantity,p.unit,factor);
    return `<span class="step-ingredient-tag">${amount?`<b>${esc(amount)}</b> `:''}${esc(p.name)}${p.preparation?` <span class="step-tag-prep">· ${esc(p.preparation)}</span>`:''}${p.optional?' <em>optional</em>':''}</span>`;
  }).join('')}</div>`;
}
function renderServingControl(){
  const label=declaredServings&&Math.abs(selectedServings-baseServings)<0.00001?originalServingLabel:`${selectedServings} ${selectedServings===1?'serving':'servings'}`;
  const helper=declaredServings?`From original yield: ${esc(originalServingLabel)}`:'Original yield not specified';
  return `<div class="serving-control"><div class="serving-copy"><span class="serving-label">Servings</span><span class="serving-current">${esc(label)}</span><span class="serving-helper">${helper}</span></div><div class="serving-stepper"><button type="button" id="serving-minus" aria-label="Decrease servings" ${selectedServings<=1?'disabled':''}>${icon('minus')}</button><output id="serving-count" aria-live="polite">${selectedServings}</output><button type="button" id="serving-plus" aria-label="Increase servings" ${selectedServings>=100?'disabled':''}>${icon('plus')}</button></div></div>`;
}
async function loadRecipe(id){
  app.innerHTML='<div class="loading"><span class="spinner"></span> Loading recipe…</div>';
  try{
    const response=await fetch('/api/recipes/'+id.split('/').map(encodeURIComponent).join('/'),{cache:'no-store'});
    const data=await response.json(); if(!response.ok)throw new Error(data.error||'Recipe not found');
    renderRecipe(data,true);
  }catch(e){app.innerHTML=`<a class="back-link" href="#/">${icon('arrowLeft')} All recipes</a><div class="error-banner">Couldn't open this recipe. ${esc(e.message)}</div>`;}
}
function renderRecipe(r=currentRecipe, reset=false){
  if(r)currentRecipe=r;
  if(!currentRecipe)return;
  r=currentRecipe;
  if(reset){servingStateFor(r.metadata||{});checkedIngredients=new Set();}
  const meta=r.metadata||{};const factor=scaleFactor();
  const grouped=[];let current='';
  for(const step of (r.steps||[])){
    if(step.section!==current){current=step.section;if(current)grouped.push({kind:'section',title:current});}
    grouped.push({kind:'step',step});
  }
  let stepNumber=0;
  const stepsMarkup=grouped.length?grouped.map(entry=>{
    if(entry.kind==='section')return `<h3 class="section-label">${esc(entry.title)}</h3>`;
    stepNumber++;
    return `<article class="step"><div class="step-number">${String(stepNumber).padStart(2,'0')}</div><div class="step-body"><p>${inlineMarkup(entry.step.parts)}</p>${stepIngredientMarkup(entry.step.parts,factor)}</div></article>`;
  }).join(''):'<p class="empty-list">No instruction steps were detected. The original file is available below.</p>';
  const notesMarkup=(r.notes||[]).length?`<aside class="notes-box"><h3>Cook’s notes</h3>${r.notes.map(n=>`<p>${inlineMarkup(n.parts)}</p>`).join('')}</aside>`:'';
  const tags=(r.tags||[]).length?`<div class="recipe-tags">${tagMarkup(r.tags)}</div>`:'';
  const photo=r.photo_available?`<img class="recipe-photo" src="${esc(photoUrl(r.id,'detail',r.photo_version))}" alt="${esc(r.title)}" onerror="this.remove();this.parentElement.classList.add('photo-missing')">`:'';
  const ingredientCount=r.ingredients?.length||0;
  app.innerHTML=`
    <a class="back-link" href="#/">${icon('arrowLeft')} All recipes</a>
    ${r.warning?`<div class="error-banner">${esc(r.warning)}</div>`:''}
    <section class="recipe-header ${r.photo_available?'has-photo':''}"><div class="recipe-header-copy"><h1 class="recipe-title">${esc(r.title||'Untitled recipe')}</h1>${tags}<div class="recipe-deck">${metadataPills(meta)}<span class="meta-pill">${icon('forkKnife')} <b>${ingredientCount}</b> ingredients</span><span class="meta-pill">${icon('list')} <b>${r.steps?.length||0}</b> steps</span></div></div>${photo?`<div class="recipe-photo-frame">${photo}</div>`:''}${metadataCards(meta)}</section>
    <div class="detail-layout"><aside class="ingredients-column"><section class="side-section"><div class="serving-row">${renderServingControl()}</div><h2 class="section-heading">Ingredients <span>(${ingredientCount})</span></h2>${renderComponents(r.ingredients,'ingredient',factor)}</section><section class="side-section"><h2 class="section-heading">${icon('cookingPot')} Cookware</h2>${renderComponents(r.cookware,'cookware')}</section></aside><section class="instructions"><h2 class="section-heading instruction-heading">${icon('list')} Method</h2>${stepsMarkup}${notesMarkup}</section></div>
    <details class="raw-toggle"><summary>View original Cooklang source</summary><pre id="raw-source"></pre></details>`;
  document.getElementById('raw-source').textContent=r.source || `${r.title||'Untitled recipe'}\n${(r.steps||[]).map((s,i)=>`${i+1}. ${s.text}`).join('\n\n')}`;
  document.querySelectorAll('.ingredient-check').forEach(input=>input.addEventListener('change',e=>{
    const index=Number(e.currentTarget.dataset.ingredientIndex);
    if(e.currentTarget.checked)checkedIngredients.add(index);else checkedIngredients.delete(index);
  }));
  document.getElementById('serving-minus')?.addEventListener('click',()=>{if(selectedServings>1){selectedServings--;renderRecipe();}});
  document.getElementById('serving-plus')?.addEventListener('click',()=>{if(selectedServings<100){selectedServings++;renderRecipe();}});
}
function route(){
  const hash=location.hash||'#/';
  if(hash==='#/'||hash==='#'||hash==='#/home'){currentRecipe=null;loadIndex();return;}
  const match=hash.match(/^#\/recipe\/(.+)$/);
  if(match){let id;try{id=decodeURIComponent(match[1]);}catch{id=match[1];}loadRecipe(id);return;}
  location.hash='/';
}
window.addEventListener('hashchange',route);
window.addEventListener('keydown',e=>{
  if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    const search=document.getElementById('recipe-search');
    if(search){e.preventDefault();search.focus();}
  }
  if(e.key==='Escape'&&document.activeElement?.id==='recipe-search'){
    document.activeElement.value='';renderHome('');
  }
});
route();
