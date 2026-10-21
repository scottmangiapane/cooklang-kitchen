#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import {
  Parser,
  ingredient_display_name,
  ingredient_should_be_listed,
  ingredient_is_optional,
  cookware_display_name,
  cookware_should_be_listed,
  cookware_is_optional,
  quantity_display,
  grouped_quantity_display,
} from '@cooklang/cooklang';

const parser = new Parser();

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const resolveRoot = value => {
  try { return fs.realpathSync(value); }
  catch { return path.resolve(value); }
};
const ROOT = resolveRoot(process.env.RECIPES_DIR || '/recipes');
const WEB = path.join(APP_DIR, 'static');
const IMAGE_CACHE_DIR = path.resolve(process.env.IMAGE_CACHE_DIR || '/image-cache');
const RECIPE_CACHE_DIR = path.resolve(process.env.RECIPE_CACHE_DIR || '/recipe-cache');
const PORT = 8080;
const RECIPE_SUFFIXES = ['.cook', '.txt'];
const RECIPE_CACHE_VERSION = 9;
const IMAGE_SIZES = { card: { width: 800, height: 560 }, detail: { width: 1440, height: 1200 } };
const IMAGE_MIMES = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif',
};
const STATIC_MIMES = {
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};
const parsedRecipes = new Map();
const imageJobs = new Map();
const normal = value => String(value ?? '').replace(/\s+/g, ' ').trim();

function hash(value, length = 32) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, length);
}

function toJsonValue(value) {
  if (value === undefined || value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value instanceof Map) {
    return Object.fromEntries([...value].map(([key, item]) => [String(key), toJsonValue(item)]));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return String(value);
}

function recipeAst(recipe) {
  return recipe?.recipe;
}

function recipeMetadata(recipe) {
  if (recipe?.display_metadata) return recipe.display_metadata;

  // The JS bindings expose `recipe.raw_metadata` as the Metadata wrapper,
  // with its original key/value pairs in `.map`. Older API shapes are kept
  // only as compatibility fallbacks.
  const rawMetadata = recipe?.recipe?.raw_metadata;
  const raw = toJsonValue(rawMetadata?.map ?? rawMetadata ?? recipe?.recipe?.metadata?.map ?? {});
  const interpreted = toJsonValue(recipe?.metadata || {});
  const metadata = { ...raw, ...(interpreted.custom || {}) };

  // Prefer the parser's interpreted standard fields where useful, while
  // retaining custom and standard keys exactly as written in the raw map.
  const standardFields = [
    ['title', interpreted.title, []],
    ['description', interpreted.description, ['introduction']],
    ['tags', interpreted.tags, ['tag']],
    ['author', interpreted.author, []],
    ['source', interpreted.source, []],
    ['course', interpreted.course, ['category']],
    ['servings', interpreted.servings, ['serves', 'yield']],
    ['difficulty', interpreted.difficulty, []],
    ['cuisine', interpreted.cuisine, []],
    ['diet', interpreted.diet, []],
    ['image', interpreted.images, ['images', 'picture', 'pictures']],
    ['locale', interpreted.locale, []],
  ];
  for (const [key, value, aliases] of standardFields) {
    if (value !== undefined && value !== null) metadata[key] = value;
    if (value !== undefined && value !== null) {
      for (const alias of aliases) delete metadata[alias];
    }
  }

  // Keep the source's human-readable time values (e.g. "20 minutes") rather
  // than replacing them with the parser's interpreted minute-count object.
  return metadata;
}

function parseOfficialAst(source) {
  // `parse_ast` is the official structure-preserving parse. The full Recipe
  // model below remains the source of scaled quantities and component indexes.
  const result = parser.parse_ast(source, true);
  if (!result?.value || result.value === '<no output>') {
    throw new Error('The official Cooklang parser did not return an AST.');
  }
  return JSON.parse(result.value);
}

function annotateTextBlocksFromAst(ast, recipe) {
  // The full parse has the analyzed quantities/components the UI needs, but
  // currently flattens TextBlock content into ordinary text. Copy only that
  // missing structural distinction from the official AST onto the matching
  // full-parse content item, leaving the rest of the parsed recipe untouched.
  const sections = recipe?.sections || [];
  let sectionIndex = 0;
  let contentIndex = 0;
  let hasSection = false;
  let hasContentInCurrentSection = false;

  for (const block of ast?.blocks || []) {
    if (!block || typeof block !== 'object') continue;
    const type = Object.keys(block)[0];
    if (type === 'Section') {
      // The full parse omits an empty, unnamed default section. If source
      // content preceded the first header, however, that section is retained.
      if (hasSection || hasContentInCurrentSection) sectionIndex += 1;
      hasSection = true;
      contentIndex = 0;
      hasContentInCurrentSection = false;
      continue;
    }

    if (type !== 'Step' && type !== 'TextBlock') continue;
    const content = sections[sectionIndex]?.content?.[contentIndex];
    if (type === 'TextBlock' && content) content.type = 'textBlock';
    contentIndex += 1;
    hasContentInCurrentSection = true;
  }
}

function recipeDisplayHelpers(parsed) {
  const ast = parsed.recipe;
  return {
    ingredientNames: ast.ingredients.map(ingredient_display_name),
    ingredientListed: ast.ingredients.map(ingredient_should_be_listed),
    ingredientOptional: ast.ingredients.map(ingredient_is_optional),
    ingredientQuantities: ast.ingredients.map(ingredient => ingredient.quantity ? quantity_display(ingredient.quantity) : ''),
    cookwareNames: ast.cookware.map(cookware_display_name),
    cookwareListed: ast.cookware.map(cookware_should_be_listed),
    cookwareOptional: ast.cookware.map(cookware_is_optional),
    timerQuantities: ast.timers.map(timer => timer.quantity ? quantity_display(timer.quantity) : ''),
    inlineQuantities: ast.inline_quantities.map(quantity_display),
    groupedIngredients: parser.group_ingredients(parsed)
      .filter(({ index }) => ingredient_should_be_listed(ast.ingredients[index]))
      .map(({ index, quantity }) => ({ index, quantity: grouped_quantity_display(quantity) })),
    groupedCookware: parser.group_cookware(parsed)
      .filter(({ index }) => cookware_should_be_listed(ast.cookware[index]))
      .map(({ index, quantity }) => ({ index, quantity: grouped_quantity_display(quantity) })),
  };
}

function recipeBaseName(recipePath) {
  const name = path.basename(recipePath);
  const lower = name.toLowerCase();
  if (lower.endsWith('.cook.txt')) return name.slice(0, -9);
  if (lower.endsWith('.cook')) return name.slice(0, -5);
  if (lower.endsWith('.txt')) return name.slice(0, -4);
  return path.parse(name).name;
}

function recipeDisplayName(recipePath) {
  return normal(recipeBaseName(recipePath).replace(/[_-]/g, ' '));
}

function isRecipeFile(recipePath) {
  try {
    return fs.statSync(recipePath).isFile() && RECIPE_SUFFIXES.some(suffix => path.basename(recipePath).toLowerCase().endsWith(suffix));
  } catch {
    return false;
  }
}

function isWithinRoot(candidate) {
  const relative = path.relative(ROOT, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeExistingPath(candidate) {
  try {
    const resolved = fs.realpathSync(candidate);
    return isWithinRoot(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function recipePhotoPath(recipePath, metadata = {}) {
  const imageValues = ['image', 'images', 'picture', 'pictures']
    .flatMap(key => Array.isArray(metadata?.[key]) ? metadata[key] : [metadata?.[key]]);
  for (const value of imageValues) {
    if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value.trim())) continue;
    const found = safeExistingPath(path.resolve(path.dirname(recipePath), value.trim()));
    if (found && IMAGE_MIMES[path.extname(found).toLowerCase()] && fs.statSync(found).isFile()) return found;
  }

  const base = recipeBaseName(recipePath);
  for (const suffix of Object.keys(IMAGE_MIMES)) {
    const found = safeExistingPath(path.join(path.dirname(recipePath), base + suffix));
    if (found && fs.statSync(found).isFile()) return found;
  }
  return null;
}

function photoVersion(photoPath) {
  if (!photoPath) return '';
  try {
    const stat = fs.statSync(photoPath, { bigint: true });
    return `${hash(path.relative(ROOT, photoPath).split(path.sep).join('/'), 8)}-${stat.mtimeNs.toString(16)}-${stat.size.toString(16)}`;
  } catch {
    return '';
  }
}

async function optimizedPhoto(photoPath, requestedVariant) {
  const originalType = IMAGE_MIMES[path.extname(photoPath).toLowerCase()] || 'application/octet-stream';
  const variant = IMAGE_SIZES[requestedVariant] ? requestedVariant : 'detail';
  const relative = path.relative(ROOT, photoPath).split(path.sep).join('/');
  const outputKey = hash(`${relative}::${variant}`, 28);
  const output = path.join(IMAGE_CACHE_DIR, `${outputKey}.webp`);
  const manifest = path.join(IMAGE_CACHE_DIR, `${outputKey}.json`);

  let signature;
  try {
    const stat = fs.statSync(photoPath, { bigint: true });
    signature = {
      version: 3,
      source: relative,
      mtime_ns: stat.mtimeNs.toString(),
      size: stat.size.toString(),
      variant,
    };
  } catch {
    return { data: fs.readFileSync(photoPath), contentType: originalType };
  }

  const cached = () => {
    try {
      const oldSignature = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (JSON.stringify(oldSignature) === JSON.stringify(signature) && fs.existsSync(output)) {
        return fs.readFileSync(output);
      }
    } catch { /* Missing or outdated cache. */ }
    return null;
  };
  const cachedImage = cached();
  if (cachedImage) return { data: cachedImage, contentType: 'image/webp' };
  if (imageJobs.has(outputKey)) return imageJobs.get(outputKey);

  const job = (async () => {
    try {
      fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
      const size = IMAGE_SIZES[variant];
      const webp = await sharp(photoPath, { animated: false })
        .rotate()
        .resize({ width: size.width, height: size.height, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: variant === 'card' ? 86 : 84, effort: 5 })
        .toBuffer();
      const tempImage = `${output}.${process.pid}.tmp`;
      const tempManifest = `${manifest}.${process.pid}.tmp`;
      fs.writeFileSync(tempImage, webp);
      fs.writeFileSync(tempManifest, JSON.stringify(signature));
      fs.renameSync(tempImage, output);
      fs.renameSync(tempManifest, manifest);
      return { data: webp, contentType: 'image/webp' };
    } catch {
      return { data: fs.readFileSync(photoPath), contentType: originalType };
    }
  })();
  imageJobs.set(outputKey, job);
  try { return await job; }
  finally { imageJobs.delete(outputKey); }
}

function fileSignature(recipePath) {
  const stat = fs.statSync(recipePath, { bigint: true });
  return { mtime_ns: stat.mtimeNs.toString(), size: stat.size.toString(), inode: stat.ino.toString() };
}

function cachePath(relativeId) {
  return path.join(RECIPE_CACHE_DIR, `${hash(relativeId)}.json`);
}

function readRecipeCache(relativeId, signature) {
  const memory = parsedRecipes.get(relativeId);
  if (memory && !memory.retry && JSON.stringify(memory.signature) === JSON.stringify(signature)) return memory.recipe;
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath(relativeId), 'utf8'));
    if (payload.version === RECIPE_CACHE_VERSION && JSON.stringify(payload.signature) === JSON.stringify(signature) && payload.recipe && typeof payload.recipe === 'object') {
      parsedRecipes.set(relativeId, { signature, recipe: payload.recipe });
      return payload.recipe;
    }
  } catch { /* Missing, stale, or malformed cache. */ }
  return null;
}

function writeRecipeCache(relativeId, signature, recipe) {
  try {
    fs.mkdirSync(RECIPE_CACHE_DIR, { recursive: true });
    const destination = cachePath(relativeId);
    const temporary = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ version: RECIPE_CACHE_VERSION, signature, recipe }));
    fs.renameSync(temporary, destination);
  } catch (error) {
    console.log(`Recipe cache write failed for ${relativeId}: ${error?.name || 'Error'}`);
  }
}

function parseRecipeSource(recipePath, source, scale = 1) {
  const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
  const parsed = parser.parse(source, scale);
  const payload = toJsonValue(parsed);
  if (!payload?.recipe || !Array.isArray(payload.recipe.sections)) {
    throw new Error('The official Cooklang parser returned an unexpected recipe structure.');
  }

  const syntaxAst = parseOfficialAst(source);
  annotateTextBlocksFromAst(syntaxAst, payload.recipe);

  const recipe = {
    ...payload,
    display: recipeDisplayHelpers(parsed),
    syntax_ast: syntaxAst,
    id: relativeId,
    source,
    source_name: path.basename(recipePath),
  };
  recipe.display_metadata = recipeMetadata(recipe);
  const photo = recipePhotoPath(recipePath, recipeMetadata(recipe));
  recipe.photo_available = Boolean(photo);
  recipe.photo_version = photoVersion(photo);
  return recipe;
}

function parseUncachedPaths(entries) {
  for (const [recipePath, signature] of entries) {
    const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
    try {
      const source = fs.readFileSync(recipePath, 'utf8');
      const recipe = parseRecipeSource(recipePath, source, 1);
      parsedRecipes.set(relativeId, { signature, recipe });
      writeRecipeCache(relativeId, signature, recipe);
    } catch (error) {
      const recipe = {
        id: relativeId,
        source: fs.existsSync(recipePath) ? fs.readFileSync(recipePath, 'utf8') : '',
        source_name: path.basename(recipePath),
        parser_error: String(error?.message || error),
        photo_available: false,
        photo_version: '',
      };
      parsedRecipes.set(relativeId, { signature, recipe, retry: true });
    }
  }
}

function refreshPhotoFields(recipe, recipePath) {
  const result = { ...recipe };
  const photo = recipePhotoPath(recipePath, recipeMetadata(result));
  result.photo_available = Boolean(photo);
  result.photo_version = photoVersion(photo);
  return result;
}

function parseRecipe(recipePath, scale = 1) {
  if (scale !== 1) {
    const source = fs.readFileSync(recipePath, 'utf8');
    return parseRecipeSource(recipePath, source, scale);
  }

  const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
  const signature = fileSignature(recipePath);
  const cached = readRecipeCache(relativeId, signature);
  if (cached) return refreshPhotoFields(cached, recipePath);
  parseUncachedPaths([[recipePath, signature]]);
  const entry = parsedRecipes.get(relativeId);
  if (!entry) throw new Error('Recipe parser did not return a result.');
  return refreshPhotoFields(entry.recipe, recipePath);
}

function recipeInventory() {
  if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) return [];
  const found = [];
  const walk = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); }
    catch { return; }
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(candidate);
      else if (entry.isFile() && RECIPE_SUFFIXES.some(suffix => entry.name.toLowerCase().endsWith(suffix))) {
        try {
          const safe = safeExistingPath(candidate);
          if (safe && isRecipeFile(safe)) found.push([safe, fileSignature(safe)]);
        } catch { /* Ignore recipes that disappear while scanning. */ }
      }
    }
  };
  walk(ROOT);
  return found.sort((a, b) => path.relative(ROOT, a[0]).localeCompare(path.relative(ROOT, b[0]), undefined, { sensitivity: 'base' }));
}

function loadRecipeLibrary() {
  if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) return [];
  const inventory = recipeInventory();
  const activeIds = new Set(inventory.map(([recipePath]) => path.relative(ROOT, recipePath).split(path.sep).join('/')));
  for (const relativeId of parsedRecipes.keys()) {
    if (activeIds.has(relativeId)) continue;
    parsedRecipes.delete(relativeId);
    try { fs.unlinkSync(cachePath(relativeId)); } catch { /* Missing or unavailable cache. */ }
  }

  const misses = inventory.filter(([recipePath, signature]) => {
    const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
    return readRecipeCache(relativeId, signature) === null;
  });
  parseUncachedPaths(misses);

  return inventory.flatMap(([recipePath]) => {
    const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
    const entry = parsedRecipes.get(relativeId);
    return entry ? [refreshPhotoFields(entry.recipe, recipePath)] : [];
  });
}

function listRecipes() {
  return loadRecipeLibrary().map(recipe => {
    if (recipe.parser_error) {
      return {
        id: recipe.id,
        title: recipeDisplayName(recipe.id) || 'Untitled recipe',
        tags: [],
        ingredient_count: 0,
        step_count: 0,
        photo_available: false,
        photo_version: '',
        parser_error: recipe.parser_error,
      };
    }
    const ast = recipe.recipe;
    const metadata = recipeMetadata(recipe);
    const title = normal(metadata.title || recipeDisplayName(recipe.id)) || 'Untitled recipe';
    const tags = (metadata.tags || []).map(normal).filter(Boolean);
    const stepCount = ast.sections.reduce((count, section) => count
      + section.content.filter(content => content.type === 'step'
        || content.type === 'text' && content.value.trim()).length, 0);
    return {
      id: recipe.id,
      title,
      tags,
      ingredient_count: recipe.display.groupedIngredients.length,
      step_count: stepCount,
      photo_available: recipe.photo_available,
      photo_version: recipe.photo_version,
    };
  });
}

function recipePathFromId(id) {
  if (!id || id.includes('\0') || !RECIPE_SUFFIXES.some(suffix => id.toLowerCase().endsWith(suffix))) return null;
  const candidate = path.resolve(ROOT, id);
  if (!isWithinRoot(candidate)) return null;
  const safe = safeExistingPath(candidate);
  return safe && isRecipeFile(safe) ? safe : null;
}

function send(res, data, contentType, status = 200, cacheControl = 'no-store') {
  if (res.destroyed) return;
  const body = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': cacheControl,
  });
  res.end(body);
}

function sendJson(res, value, status = 200) {
  send(res, JSON.stringify(value), 'application/json; charset=utf-8', status);
}

async function handleRequest(req, res) {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://localhost');
    pathname = decodeURIComponent(url.pathname);
  } catch {
    send(res, 'Bad request', 'text/plain; charset=utf-8', 400);
    return;
  }

  if (req.method !== 'GET') {
    send(res, 'Method not allowed', 'text/plain; charset=utf-8', 405);
    return;
  }

  if (pathname === '/api/recipes') {
    sendJson(res, { recipes: listRecipes(), directory_ok: fs.existsSync(ROOT) && fs.statSync(ROOT).isDirectory() });
    return;
  }

  if (pathname.startsWith('/api/photos/')) {
    const recipePath = recipePathFromId(pathname.slice('/api/photos/'.length));
    if (!recipePath) { send(res, 'Photo not found', 'text/plain; charset=utf-8', 404); return; }
    try {
      const recipe = parseRecipe(recipePath);
      const photo = recipePhotoPath(recipePath, recipeMetadata(recipe));
      if (!photo) { send(res, 'Photo not found', 'text/plain; charset=utf-8', 404); return; }
      const { data, contentType } = await optimizedPhoto(photo, url.searchParams.get('size') || 'detail');
      send(res, data, contentType, 200, 'public, max-age=31536000, immutable');
    } catch {
      send(res, 'Photo not found', 'text/plain; charset=utf-8', 404);
    }
    return;
  }

  if (pathname.startsWith('/api/recipes/')) {
    const id = pathname.slice('/api/recipes/'.length);
    const scale = Number(url.searchParams.get('scale') ?? 1);
    if (!Number.isFinite(scale) || scale <= 0 || scale > 100) {
      sendJson(res, { error: 'Scale must be a number greater than 0 and at most 100.' }, 400);
      return;
    }
    const recipePath = recipePathFromId(id);
    if (!recipePath) { sendJson(res, { error: 'Recipe not found.' }, 404); return; }
    try {
      sendJson(res, parseRecipe(recipePath, scale));
    } catch (error) {
      let source = '';
      try { source = fs.readFileSync(recipePath, 'utf8'); } catch { /* Keep fallback response useful. */ }
      sendJson(res, {
        id,
        source,
        source_name: path.basename(recipePath),
        parser_error: String(error?.message || error),
        photo_available: false,
        photo_version: '',
      });
    }
    return;
  }

  if (pathname === '/' || pathname === '/index.html') {
    try { send(res, fs.readFileSync(path.join(WEB, 'index.html')), 'text/html; charset=utf-8'); }
    catch { send(res, 'Frontend file missing.', 'text/plain; charset=utf-8', 500); }
    return;
  }

  if (pathname.startsWith('/static/')) {
    let candidate;
    try { candidate = fs.realpathSync(path.resolve(WEB, pathname.slice('/static/'.length))); }
    catch { send(res, 'Not found', 'text/plain; charset=utf-8', 404); return; }
    const relative = path.relative(fs.realpathSync(WEB), candidate);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative) || !fs.statSync(candidate).isFile()) {
      send(res, 'Not found', 'text/plain; charset=utf-8', 404);
      return;
    }
    const contentType = STATIC_MIMES[path.extname(candidate).toLowerCase()] || 'application/octet-stream';
    const cache = ['app.js', 'style.css', 'icons.js'].includes(path.basename(candidate)) ? 'no-cache' : 'public, max-age=3600';
    send(res, fs.readFileSync(candidate), contentType, 200, cache);
    return;
  }

  send(res, 'Not found', 'text/plain; charset=utf-8', 404);
}

const server = createServer((req, res) => {
  handleRequest(req, res).catch(error => {
    console.error(`Request failed: ${error?.stack || error}`);
    if (!res.headersSent) send(res, 'Internal server error', 'text/plain; charset=utf-8', 500);
    else res.destroy();
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Cooklang Kitchen serving ${ROOT} on :${PORT}; image cache ${IMAGE_CACHE_DIR}; recipe cache ${RECIPE_CACHE_DIR}`);
});
