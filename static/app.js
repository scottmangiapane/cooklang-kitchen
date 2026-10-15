const app = document.getElementById('app');
let recipeCache = [];
const iconFor = (index) => ['✳','◒','⌁','♨','✿','◉','✦'][index % 7];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const prettyKey = k => String(k).replace(/[_-]+/g,' ').replace(/\b\w/g, c=>c.toUpperCase());
const human = v => Array.isArray(v) ? v.map(human).join(', ') : (v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
function goHome(){ if(location.hash !== '#/') location.hash = '/'; else renderHome(); }
function recipeUrl(id){ return '#/recipe/' + encodeURIComponent(id); }
function tagMarkup(tags){ return (tags||[]).slice(0,4).map(t=>`<span class="tag">${esc(t)}</span>`).join(''); }
async function loadIndex(){
  app.innerHTML='<div class="loading"><span class="spinner"></span> Opening your recipe book…</div>';
  try{
    const response=await fetch('/api/recipes',{cache:'no-store'}); if(!response.ok) throw new Error('HTTP '+response.status);
    const data=await response.json(); recipeCache=data.recipes||[];
    renderHome('', data.directory_ok);
  }catch(e){app.innerHTML=`<div class="error-banner">Couldn't load the recipe library. ${esc(e.message)}. Check that the recipe folder is mounted and the container is running.</div>`;}
}
function renderHome(query='', directoryOk=true){
  const q=query.trim().toLocaleLowerCase();
  const recipes=recipeCache.filter(r=>!q || r.title.toLocaleLowerCase().includes(q) || (r.tags||[]).some(t=>t.toLocaleLowerCase().includes(q)) || r.id.toLocaleLowerCase().includes(q));
  const sort = document.getElementById('sort-order')?.value || 'title';
  recipes.sort((a,b)=> sort==='filename' ? a.id.localeCompare(b.id) : a.title.localeCompare(b.title,undefined,{sensitivity:'base'}));
  app.innerHTML=`
    ${!directoryOk?'<div class="error-banner">The configured recipes folder is not available inside the container. Verify the bind mount in compose.yaml.</div>':''}
    <section class="hero"><div><p class="eyebrow">THE HOME COOK'S COLLECTION</p><h1>Good food starts<br>right here.</h1><p class="subhead">A little library of recipes worth coming back to.</p></div><div class="hero-count"><span class="count-number">${recipeCache.length}</span><span class="count-label">RECIPES TO MAKE</span></div></section>
    <div class="search-wrap"><span class="search-icon" aria-hidden="true">⌕</span><input class="search" id="recipe-search" type="search" placeholder="Search recipes or tags…" value="${esc(query)}" autocomplete="off" aria-label="Search recipes"><span class="shortcut">/</span></div>
    <div class="toolbar"><span class="results-label" id="results-count">${recipes.length} ${recipes.length===1?'recipe':'recipes'}${q?' found':''}</span><label class="sort-label">Sort by <select id="sort-order" class="sort-select" aria-label="Sort recipes"><option value="title" ${sort==='title'?'selected':''}>Name</option><option value="filename" ${sort==='filename'?'selected':''}>File name</option></select></label></div>
    ${recipes.length?`<div class="recipe-grid">${recipes.map((r,i)=>`<a class="recipe-card" href="${recipeUrl(r.id)}"><div class="card-top"><span class="card-icon">${iconFor(i)}</span><span class="card-number">${String(i+1).padStart(2,'0')}</span></div><h2 class="card-title">${esc(r.title)}</h2><div class="tag-row">${tagMarkup(r.tags)}${(!r.tags||!r.tags.length)?'<span class="tag">Home cooking</span>':''}</div><div class="card-footer"><span>▤ ${r.ingredient_count||0} ingredients</span><span>↗ ${r.step_count||0} steps</span></div></a>`).join('')}</div>`:`<div class="empty"><strong>${recipeCache.length?'Nothing simmering here.':'Your recipe book is empty.'}</strong>${recipeCache.length?'Try another recipe name or tag.':'Add .cook files to the mounted Recipes folder, then refresh this page.'}</div>`}
  `;
  const input=document.getElementById('recipe-search');
  input.addEventListener('input', e=>{const value=e.target.value; const cursor=e.target.selectionStart;renderHome(value,directoryOk);const next=document.getElementById('recipe-search');next.focus();next.setSelectionRange(cursor,cursor);});
  document.getElementById('sort-order').addEventListener('change',()=>renderHome(document.getElementById('recipe-search').value,directoryOk));
}
function inlineMarkup(parts){
  return (parts||[]).map(p=>{
    if(p.type==='text') return esc(p.text).replace(/\n/g,'<br>');
    if(p.type==='ingredient') return `<span class="inline-ingredient" title="Ingredient${p.optional?' (optional)':''}">${esc(p.name)}${p.optional?' · optional':''}</span>${p.preparation?` <span>(${esc(p.preparation)})</span>`:''}`;
    if(p.type==='cookware') return `<span class="inline-cookware" title="Cookware">${esc(p.name)}</span>${p.optional?' (optional)':''}`;
    if(p.type==='timer') return `<span class="inline-timer">◷ ${esc([p.name && p.name!=='Timer'?p.name:'',p.quantity,p.unit].filter(Boolean).join(' '))}</span>`;
    return '';
  }).join('');
}
function metadataPills(meta){
  const candidates=[['author','By'],['servings','Serves'],['yield','Makes'],['prep_time','Prep'],['cook_time','Cook'],['total_time','Total']];
  const found=[];
  for(const [key,label] of candidates){if(meta && meta[key]!==undefined && meta[key]!==null && human(meta[key]).trim())found.push(`<span class="meta-pill">${esc(label)} <b>${esc(human(meta[key]))}</b></span>`);}
  return found.join('');
}
function metadataCards(meta){
  if(!meta||typeof meta!=='object')return '';
  const hidden=new Set(['title','tags','author','servings','yield','prep_time','cook_time','total_time']);
  const items=Object.entries(meta).filter(([k,v])=>!hidden.has(k)&&v!==undefined&&v!==null&&human(v).trim());
  if(!items.length)return '';
  return `<div class="metadata-table">${items.map(([k,v])=>`<div class="metadata-item"><span class="metadata-key">${esc(prettyKey(k))}</span><div class="metadata-value">${esc(human(v))}</div></div>`).join('')}</div>`;
}
function renderComponents(items, type){
  if(!items?.length)return `<p class="empty-list">${type==='ingredient'?'No ingredients found in the markup.':'No cookware marked in this recipe.'}</p>`;
  if(type==='ingredient') return `<ul class="ingredient-list">${items.map((it,i)=>`<li><input class="ingredient-check" type="checkbox" id="ing-${i}"><label for="ing-${i}" style="flex:1"><span class="ingredient-main">${it.display_quantity?`<span class="ingredient-amount">${esc(it.display_quantity)}</span>`:''}<span class="ingredient-name">${esc(it.name)}</span>${it.optional?'<span class="optional">optional</span>':''}</span>${it.preparation?`<span class="ingredient-prep">${esc(it.preparation)}</span>`:''}</label></li>`).join('')}</ul>`;
  return `<ul class="cookware-list">${items.map(it=>`<li>${esc(it.name)}${it.optional?' <span class="optional">optional</span>':''}</li>`).join('')}</ul>`;
}
async function loadRecipe(id){
  app.innerHTML='<div class="loading"><span class="spinner"></span> Setting the table…</div>';
  try{
    const response=await fetch('/api/recipes/'+id.split('/').map(encodeURIComponent).join('/'),{cache:'no-store'});
    const data=await response.json(); if(!response.ok)throw new Error(data.error||'Recipe not found'); renderRecipe(data);
  }catch(e){app.innerHTML=`<a class="back-link" href="#/">← All recipes</a><div class="error-banner">Couldn't open this recipe. ${esc(e.message)}</div>`;}
}
function renderRecipe(r){
  const meta=r.metadata||{};
  const grouped=[]; let current='';
  for(const step of (r.steps||[])){
    if(step.section!==current){current=step.section;if(current)grouped.push({kind:'section',title:current});}
    grouped.push({kind:'step',step});
  }
  const stepsMarkup=grouped.length?grouped.map((entry,i)=>entry.kind==='section'?`<h3 class="section-label">${esc(entry.title)}</h3>`:`<div class="step"><div class="step-number">${String(grouped.slice(0,i).filter(x=>x.kind==='step').length+1).padStart(2,'0')}</div><p>${inlineMarkup(entry.step.parts)}</p></div>`).join(''):'<p class="empty-list">No instruction steps were detected. The original file is available below.</p>';
  const notesMarkup=(r.notes||[]).length?`<aside class="notes-box"><h3>Cook's notes</h3>${r.notes.map(n=>`<p>${inlineMarkup(n.parts)}</p>`).join('')}</aside>`:'';
  const tags=(r.tags||[]).length?`<div class="recipe-deck">${tagMarkup(r.tags)}</div>`:'';
  const unknown=[];
  if(meta.author && !meta.servings && !meta.yield) unknown.push('');
  app.innerHTML=`
    <a class="back-link" href="#/">← All recipes</a>
    ${r.warning?`<div class="error-banner">${esc(r.warning)}</div>`:''}
    <section class="recipe-header"><p class="eyebrow">FROM YOUR RECIPE BOOK</p><h1 class="recipe-title">${esc(r.title||'Untitled recipe')}</h1>${tags}<div class="recipe-deck">${metadataPills(meta)}<span class="meta-pill">▤ <b>${r.ingredients?.length||0}</b> ingredients</span><span class="meta-pill">↗ <b>${r.steps?.length||0}</b> steps</span></div>${metadataCards(meta)}</section>
    <div class="detail-layout"><aside class="ingredients-column"><section class="side-section"><h2 class="section-heading"><span class="heading-icon">✳</span> Ingredients <span>(${r.ingredients?.length||0})</span></h2>${renderComponents(r.ingredients,'ingredient')}</section><section class="side-section"><h2 class="section-heading"><span class="heading-icon">⌑</span> Cookware</h2>${renderComponents(r.cookware,'cookware')}</section></aside><section class="instructions"><h2 class="section-heading instruction-heading"><span class="heading-icon">↗</span> Method</h2>${stepsMarkup}${notesMarkup}</section></div>
    <details class="raw-toggle"><summary>View original Cooklang source</summary><pre id="raw-source-loading">Loading source…</pre></details>`;
  const pre=document.getElementById('raw-source-loading');
  pre.textContent=r.source || `${r.title||'Untitled recipe'}\n${(r.steps||[]).map((s,i)=>`${i+1}. ${s.text}`).join('\n\n')}`;
}
function route(){
  const hash=location.hash||'#/';
  if(hash==='#/'||hash==='#'||hash==='#/home'){loadIndex();return;}
  const match=hash.match(/^#\/recipe\/(.+)$/);
  if(match){let id;try{id=decodeURIComponent(match[1]);}catch{ id=match[1];}loadRecipe(id);return;}
  location.hash='/';
}
window.addEventListener('hashchange',route);
window.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)&&!e.ctrlKey&&!e.metaKey){e.preventDefault();document.getElementById('recipe-search')?.focus();}if(e.key==='Escape'&&document.activeElement?.id==='recipe-search'){document.activeElement.value='';renderHome('');}});
route();
