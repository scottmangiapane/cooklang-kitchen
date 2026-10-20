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
const human = v => {
  if (Array.isArray(v)) return v.map(human).filter(Boolean).join(', ');
  if (v && typeof v === 'object') {
    if ('name' in v || 'url' in v) return [v.name, v.url].filter(Boolean).join(' — ');
    return JSON.stringify(v);
  }
  return String(v ?? '');
};
const icon = (name, cls='') => window.kitchenIcon ? window.kitchenIcon(name, cls) : '';
function recipeUrl(id){ return '#/recipe/' + encodeURIComponent(id); }
function photoUrl(id, size='detail', version=''){
  const query = new URLSearchParams({size});
  if(version) query.set('v', version);
  return '/api/photos/' + id.split('/').map(encodeURIComponent).join('/') + '?' + query.toString();
}
function tagMarkup(tags, limit=Infinity){ const all=tags||[]; const shown=all.slice(0,limit); const hidden=Math.max(0,all.length-shown.length); return shown.map(t=>`<span class="tag">${icon('tag','tag-icon')}${esc(t)}</span>`).join('')+(hidden?`<span class="tag tag-overflow" title="${hidden} more tags" aria-label="${hidden} more tags">+${hidden}</span>`:''); }
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
    app.innerHTML=`<div class="error-banner">Couldn't load the recipe library (${esc(e.message)}).</div><button class="retry-button" id="retry-connection" type="button">Try again</button>`;
    document.getElementById('retry-connection')?.addEventListener('click', loadIndex);
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
      const photo = r.photo_available ? `<img class="card-photo" src="${esc(photoUrl(r.id,'card',r.photo_version))}" alt="" loading="lazy" decoding="async" onerror="this.remove();this.parentElement.classList.add('photo-missing')">` : '';
      return `<a class="recipe-card ${r.photo_available?'has-photo':''}" href="${recipeUrl(r.id)}"><div class="card-top ${r.photo_available?'with-photo':''}">${r.photo_available?photo:`<span class="card-icon">${icon('bookOpen')}</span>`}<span class="card-number">${String(i+1).padStart(2,'0')}</span></div><h2 class="card-title">${esc(r.title)}</h2><div class="tag-row">${tagMarkup(r.tags,6)}</div><div class="card-footer"><span>${icon('forkKnife')} ${r.ingredient_count||0} ingredients</span><span>${icon('list')} ${r.step_count||0} steps</span></div></a>`;
    }).join('')}</div>`:`<div class="empty"><strong>${recipeCache.length?'No matching recipes':'No recipes found'}</strong><span>${recipeCache.length?'Try another name or tag.':'Add .cook or .txt recipe files to the mounted Recipes folder.'}</span></div>`}
  `;
  const input=document.getElementById('recipe-search');
  input.addEventListener('input', e=>{
    const value=e.target.value; const cursor=e.target.selectionStart;
    renderHome(value,directoryOk);
    const next=document.getElementById('recipe-search'); next.focus(); next.setSelectionRange(cursor,cursor);
  });
  document.getElementById('sort-order').addEventListener('change',()=>renderHome(document.getElementById('recipe-search').value,directoryOk));
}

function recipeAst(recipe){return recipe.recipe;}
function recipeMetadata(recipe){
  if(recipe.display_metadata&&typeof recipe.display_metadata==='object')return recipe.display_metadata;
  const rawMetadata=recipe.recipe?.raw_metadata;
  const raw=rawMetadata?.map || rawMetadata || recipe.recipe?.metadata?.map || {};
  const interpreted=recipe.metadata;
  return {
    ...raw,
    ...interpreted.custom,
    ...(interpreted.title!==undefined?{title:interpreted.title}:{}),
    ...(interpreted.description!==undefined?{description:interpreted.description}:{}),
    ...(interpreted.tags!==undefined?{tags:interpreted.tags}:{}),
    ...(interpreted.servings!==undefined?{servings:interpreted.servings}:{}),
  };
}
function recipeTags(meta){return (meta.tags||[]).map(tag=>tag.trim()).filter(Boolean);}
function metadataCards(meta,photoAvailable=false){
  const hidden=new Set(['title','tags','servings','serves','yield']);
  if(photoAvailable)for(const key of ['image','images','picture','pictures'])hidden.add(key);
  const items=Object.entries(meta).filter(([key,value])=>!hidden.has(key.toLowerCase().replace(/[_-]+/g,' '))&&value!==undefined&&value!==null&&human(value).trim());
  if(!items.length)return '';
  return `<div class="metadata-table">${items.map(([key,value])=>`<div class="metadata-item"><span class="metadata-key">${esc(prettyKey(key))}</span><div class="metadata-value">${esc(human(value))}</div></div>`).join('')}</div>`;
}
function astSections(ast){return ast.sections;}
function contentItems(content){return content.value.items;}
function quantityText(text){return String(text||'').replace(/\s*°?([FC])$/i,'°$1');}
function mergeSidebarComponents(items,{includePreparation=false}={}){
  const totals=new Map();
  for(const item of items){
    const amount=String(item.quantity||'').trim();
    const match=amount.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(.*?)$/);
    const key=[item.name.toLocaleLowerCase(),item.optional,includePreparation?(item.preparation||'').toLocaleLowerCase():'',match?match[2].trim().toLocaleLowerCase():amount].join('\u0000');
    const existing=totals.get(key);
    if(existing&&match){
      const previous=String(existing.quantity||'').match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*(.*?)$/);
      if(previous){
        const sum=Number(previous[1])+Number(match[1]);
        existing.quantity=`${Number(sum.toFixed(6))}${match[2]?' '+match[2].trim():''}`;
        continue;
      }
    }
    if(!existing)totals.set(key,{...item});
    else totals.set(`${key}\u0000${item.index}`,{...item});
  }
  return [...totals.values()];
}
function sidebarIngredients(recipe){
  const ast=recipeAst(recipe),display=recipe.display;
  const items=display.groupedIngredients.map(({index,quantity})=>({
    index,
    name:display.ingredientNames[index],
    optional:display.ingredientOptional[index],
    preparation:ast.ingredients[index].note||'',
    quantity,
  }));
  return mergeSidebarComponents(items,{includePreparation:true});
}
function sidebarCookware(recipe){
  const display=recipe.display;
  const items=display.groupedCookware.filter(({index})=>display.cookwareListed[index]).map(({index,quantity})=>({
    index,
    name:display.cookwareNames[index],
    optional:display.cookwareOptional[index],
    quantity,
  }));
  return mergeSidebarComponents(items);
}
function renderComponents(items,type){
  if(!items.length)return `<p class="empty-list">${type==='ingredient'?'No ingredients found in the markup.':'No cookware marked in this recipe.'}</p>`;
  if(type==='ingredient')return `<ul class="ingredient-list">${items.map((item,index)=>{
    const amount=quantityText(item.quantity);
    return `<li><input class="ingredient-check" type="checkbox" id="ing-${index}" data-ingredient-index="${index}" ${checkedIngredients.has(index)?'checked':''}><label for="ing-${index}" style="flex:1"><span class="ingredient-main">${amount?`<span class="ingredient-amount">${esc(amount)}</span>`:''}<span class="ingredient-name">${esc(item.name)}</span>${item.optional?'<span class="optional">optional</span>':''}</span>${item.preparation?`<span class="ingredient-prep">${esc(item.preparation)}</span>`:''}</label></li>`;
  }).join('')}</ul>`;
  return `<ul class="cookware-list">${items.map(item=>{
    const amount=quantityText(item.quantity),count=Number(item.quantity);
    return `<li>${icon('cookingPot')}<span>${Number.isFinite(count)&&count>1?`<span class="cookware-count">${esc(amount)}×</span> `:''}${esc(item.name)}${item.optional?' <span class="optional">optional</span>':''}</span></li>`;
  }).join('')}</ul>`;
}
function ingredientTagMarkup(recipe,content){
  const ast=recipeAst(recipe),display=recipe.display;
  const mentions=contentItems(content).filter(item=>item.type==='ingredient'&&display.ingredientListed[item.index])
    .map(reference=>({reference,ingredient:ast.ingredients[reference.index]}));
  if(!mentions.length)return '';
  return `<div class="step-ingredients" aria-label="Ingredients used in this step">${mentions.map(({reference,ingredient})=>{
    const amount=quantityText(display.ingredientQuantities[reference.index]);
    return `<span class="step-ingredient-tag">${amount?`<b>${esc(amount)}</b> `:''}${esc(display.ingredientNames[reference.index])}${ingredient.note?` <span class="step-tag-prep">· ${esc(ingredient.note)}</span>`:''}${display.ingredientOptional[reference.index]?' <em>optional</em>':''}</span>`;
  }).join('')}</div>`;
}
function inlineItemMarkup(recipe,item){
  const ast=recipeAst(recipe),display=recipe.display;
  if(item.type==='text')return esc(item.value).replace(/\n/g,'<br>');
  if(item.type==='ingredient'){
    const ingredient=ast.ingredients[item.index];
    const name=display.ingredientNames[item.index],optional=display.ingredientOptional[item.index];
    return `<span class="inline-ingredient" title="Ingredient${optional?' (optional)':''}">${esc(name)}${optional?' · optional':''}</span>${ingredient.note?` <span class="inline-preparation">(${esc(ingredient.note)})</span>`:''}`;
  }
  if(item.type==='cookware'){
    const optional=display.cookwareOptional[item.index];
    return `<span class="inline-cookware" title="Cookware">${esc(display.cookwareNames[item.index])}</span>${optional?' <span class="optional">optional</span>':''}`;
  }
  if(item.type==='timer'){
    const timer=ast.timers[item.index];
    return `<span class="inline-timer">${icon('clock')} ${esc([timer.name,quantityText(display.timerQuantities[item.index])].filter(Boolean).join(' '))}</span>`;
  }
  if(item.type==='inlineQuantity')return esc(quantityText(display.inlineQuantities[item.index]));
  return '';
}
function stepItemsMarkup(recipe,items){return items.map(item=>inlineItemMarkup(recipe,item)).join('');}
function contentTextMarkup(recipe,content){
  if(content.type==='text')return esc(content.value).replace(/\n/g,'<br>');
  if(content.type==='step')return stepItemsMarkup(recipe,contentItems(content));
  return '';
}
function noteMarkup(texts){
  const notes=Array.isArray(texts)?texts:[texts];
  return `<aside class="notes-box"><h3>Notes</h3>${notes.map(text=>`<p>${esc(text).replace(/\n/g,'<br>')}</p>`).join('')}</aside>`;
}

function renderServingControl(){
  const label=declaredServings&&Math.abs(selectedServings-baseServings)<0.00001?originalServingLabel:`${selectedServings} ${selectedServings===1?'serving':'servings'}`;
  const helper=declaredServings?`Original servings: ${esc(originalServingLabel)}`:'Original servings not specified';
  return `<div class="serving-control"><div class="serving-copy"><span class="serving-label">Servings</span><span class="serving-current">${esc(label)}</span><span class="serving-helper">${helper}</span></div><div class="serving-stepper"><button type="button" id="serving-minus" aria-label="Decrease servings" ${selectedServings<=1?'disabled':''}>${icon('minus')}</button><output id="serving-count" aria-live="polite">${selectedServings}</output><button type="button" id="serving-plus" aria-label="Increase servings" ${selectedServings>=100?'disabled':''}>${icon('plus')}</button></div></div>`;
}
function servingStateFor(meta){
  const value=meta.servings??meta.serves??meta.yield;
  const label=human(value).trim();
  const numericValue=typeof value==='number'?value:Number.parseFloat(label);
  const servings=numericValue;
  if(value!==undefined&&value!==null&&String(value).trim()!==''&&Number.isFinite(servings)&&servings>0){
    originalServingLabel=label;
    declaredServings=true;
    baseServings=Math.max(1,Math.round(servings));
    selectedServings=baseServings;
    return;
  }
  declaredServings=false;
  originalServingLabel='';
  baseServings=2;
  selectedServings=2;
}

function scaleFactor(){return selectedServings/Math.max(1,baseServings);}
async function loadRecipe(id){
  app.innerHTML='<div class="loading"><span class="spinner"></span> Loading recipe…</div>';
  try{const response=await fetch('/api/recipes/'+id.split('/').map(encodeURIComponent).join('/'),{cache:'no-store'});const data=await response.json();if(!response.ok)throw new Error(data.error||'Recipe not found');renderRecipe(data,true);}
  catch(e){app.innerHTML=`<div class="error-banner">Couldn't open this recipe. ${esc(e.message)}</div><button class="retry-button" id="retry-connection" type="button">Try again</button>`;document.getElementById('retry-connection')?.addEventListener('click',()=>loadRecipe(id));}
}
function renderRecipe(recipe=currentRecipe,reset=false){
  if(recipe)currentRecipe=recipe;
  if(!currentRecipe)return;
  recipe=currentRecipe;
  if(recipe.parser_error){app.innerHTML=`<div class="error-banner">This recipe could not be parsed: ${esc(recipe.parser_error)}</div><details class="raw-toggle" open><summary>View original Cooklang source</summary><pre>${esc(recipe.source||'')}</pre></details>`;return;}
  const ast=recipeAst(recipe),meta=recipeMetadata(recipe);
  if(reset){servingStateFor(meta);checkedIngredients=new Set();}
  const ingredients=sidebarIngredients(recipe),cookware=sidebarCookware(recipe);
  const title=String(meta.title||recipe.id.replace(/\.cook(?:\.txt)?$|\.txt$/i,'').replace(/[_-]/g,' ')||'Untitled recipe');
  const tags=recipeTags(meta),photo=recipe.photo_available?`<img class="recipe-photo" src="${esc(photoUrl(recipe.id,'detail',recipe.photo_version))}" alt="${esc(title)}" onerror="this.remove();this.parentElement.classList.add('photo-missing')">`:'';
  let stepNumber=0,currentSection='',stepsMarkup='';
  for(const [sectionIndex,section] of astSections(ast).entries()){
    const sectionName=section.name||'';
    const sectionTextBlocks=recipe.text_blocks?.[sectionIndex]||[];
    const notesOnly=sectionName.trim().toLocaleLowerCase()==='notes'
      &&section.content.length>0
      &&section.content.every((content,index)=>sectionTextBlocks[index]||content.type==='textBlock');
    if(sectionName&&sectionName!==currentSection&&!notesOnly){stepsMarkup+=`<h3 class="section-label">${esc(sectionName)}</h3>`;}
    currentSection=sectionName;
    for(let contentIndex=0;contentIndex<section.content.length;contentIndex++){
      const content=section.content[contentIndex];
      const isTextBlock=Boolean(sectionTextBlocks[contentIndex])||content.type==='textBlock';
      if(isTextBlock){
        const notes=[];
        while(contentIndex<section.content.length){
          const candidate=section.content[contentIndex];
          const candidateIsTextBlock=Boolean(sectionTextBlocks[contentIndex])||candidate.type==='textBlock';
          if(!candidateIsTextBlock)break;
          const value=candidate.value;
          notes.push(typeof value==='string'?value:Array.isArray(value)?value.map(part=>part.value??part.text??'').join(''):human(value));
          contentIndex++;
        }
        contentIndex--;
        stepsMarkup+=noteMarkup(notes);
        continue;
      }
      if(content.type!=='step'&&content.type!=='text')continue;
      const markup=contentTextMarkup(recipe,content);
      if(!markup.trim())continue;
      stepNumber++;
      stepsMarkup+=`<article class="step"><div class="step-number">${String(stepNumber).padStart(2,'0')}</div><div class="step-body"><p>${markup}</p>${content.type==='step'?ingredientTagMarkup(recipe,content):''}</div></article>`;
    }
  }
  const tagsMarkup=tags.length?`<div class="recipe-tags">${tagMarkup(tags)}</div>`:'';
  app.innerHTML=`
    <section class="recipe-header ${recipe.photo_available?'has-photo':''}"><div class="recipe-header-copy"><h1 class="recipe-title">${esc(title)}</h1>${tagsMarkup}<div class="recipe-deck"><span class="meta-pill">${icon('forkKnife')} <b>${ingredients.length}</b> ingredients</span><span class="meta-pill">${icon('list')} <b>${stepNumber}</b> steps</span></div>${metadataCards(meta,recipe.photo_available)}</div>${photo?`<div class="recipe-photo-frame">${photo}</div>`:''}</section>
    <div class="detail-layout"><aside class="ingredients-column"><section class="side-section"><div class="serving-row">${renderServingControl()}</div><h2 class="section-heading">Ingredients <span>(${ingredients.length})</span></h2>${renderComponents(ingredients,'ingredient')}</section><section class="side-section"><h2 class="section-heading">${icon('cookingPot')} Cookware</h2>${renderComponents(cookware,'cookware')}</section></aside><section class="instructions"><h2 class="section-heading instruction-heading">${icon('list')} Method</h2>${stepsMarkup||'<p class="empty-list">No instruction steps were detected. The original file is available below.</p>'}</section></div>
    <details class="raw-toggle"><summary>View original Cooklang source</summary><pre id="raw-source"></pre></details>
    <details class="raw-toggle"><summary>View official syntax AST</summary><pre id="raw-ast"></pre></details>`;
  document.getElementById('raw-source').textContent=recipe.source;
  document.getElementById('raw-ast').textContent=JSON.stringify(recipe.syntax_ast||recipeAst(recipe), null, 2);
  document.querySelectorAll('.ingredient-check').forEach(input=>input.addEventListener('change',event=>{const index=Number(event.currentTarget.dataset.ingredientIndex);if(event.currentTarget.checked)checkedIngredients.add(index);else checkedIngredients.delete(index);}));
  document.getElementById('serving-minus')?.addEventListener('click',()=>changeServings(-1));
  document.getElementById('serving-plus')?.addEventListener('click',()=>changeServings(1));
}
async function changeServings(delta){
  const target=selectedServings+delta;
  if(target<1||target>100||!currentRecipe)return;
  const id=currentRecipe.id;
  selectedServings=target;
  try{
    const endpoint='/api/recipes/'+id.split('/').map(encodeURIComponent).join('/')+'?scale='+encodeURIComponent(scaleFactor());
    const response=await fetch(endpoint,{cache:'no-store'});
    const data=await response.json();
    if(!response.ok)throw new Error(data.error||'Recipe not found');
    renderRecipe(data,false);
  }catch(error){
    selectedServings-=delta;
    renderRecipe(currentRecipe,false);
    app.insertAdjacentHTML('afterbegin',`<div class="error-banner">Couldn't scale this recipe. ${esc(error.message)}</div>`);
  }
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

