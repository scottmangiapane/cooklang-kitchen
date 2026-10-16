#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';
import sharp from 'sharp';
import { parseBatch } from './parse_recipes.mjs';

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
const RECIPE_CACHE_VERSION = 2;
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

function safeMetadata(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(safeMetadata);
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeMetadata(item)]));
  }
  return String(value);
}

function splitFrontMatter(source) {
  const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) {
    return {
      metadata: {}, body: source,
      warning: source.startsWith('---') ? "Front matter starts with '---' but its closing delimiter was not found." : null,
    };
  }

  try {
    const metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA }) ?? {};
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return { metadata: {}, body: source.slice(match[0].length), warning: 'Front matter must be a YAML mapping; metadata was ignored.' };
    }
    return { metadata: safeMetadata(metadata), body: source.slice(match[0].length), warning: null };
  } catch (error) {
    return {
      metadata: {}, body: source.slice(match[0].length),
      warning: `Could not parse YAML metadata (${error?.name || 'Error'}); recipe text was still loaded.`,
    };
  }
}

function extractNotes(body) {
  const notes = [];
  const keptBlocks = body.replace(/\\[ \t]*\r?\n/g, '\n').split(/\n\s*\n+/).map(block => {
    const lines = block.split(/\r?\n/).map(line => line.replace(/[ \t]+$/, '')).filter(line => line.trim());
    if (!lines.length || !lines[0].trimStart().startsWith('>')) return block;
    const noteLines = [];
    const otherLines = [];
    for (const line of lines) {
      (line.trimStart().startsWith('>') ? noteLines : otherLines).push(line);
    }
    const note = noteLines.map(line => line.replace(/^\s*>\s?/, '')).join('\n').trim();
    if (note) notes.push(note);
    return otherLines.join('\n');
  });
  return { body: keptBlocks.join('\n\n'), notes };
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
  for (const key of ['photo', 'image', 'photo_file', 'image_file']) {
    const value = metadata?.[key];
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

function prepareParserInput(recipePath) {
  const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
  const source = fs.readFileSync(recipePath, 'utf8');
  const { metadata, body, warning } = splitFrontMatter(source);
  const { body: recipeBody, notes } = extractNotes(body);
  return {
    request: { id: relativeId, source: recipeBody, notes, fallback_title: recipeDisplayName(recipePath), front_matter_warning: warning },
    source,
    metadata,
    warning,
    relativeId,
  };
}

function finishRecipe(recipePath, source, yamlMetadata, frontMatterWarning, parserResult) {
  const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
  if (parserResult?.error) {
    return {
      id: relativeId, title: recipeDisplayName(recipePath) || 'Untitled recipe', tags: [],
      metadata: safeMetadata(yamlMetadata), ingredients: [], cookware: [], timers: [], steps: [], notes: [], sections: [],
      warning: `Could not parse this file with the official Cooklang parser (${parserResult.error}).`,
      photo_available: false, photo_version: '', source_name: path.basename(recipePath), source,
    };
  }

  const recipe = parserResult?.recipe || {};
  const parserMetadata = recipe.metadata && typeof recipe.metadata === 'object' ? recipe.metadata : {};
  const metadata = { ...parserMetadata, ...(yamlMetadata && typeof yamlMetadata === 'object' ? yamlMetadata : {}) };
  const title = normal(metadata.title || recipe.title || recipeDisplayName(recipePath)) || 'Untitled recipe';
  let tags = metadata.tags ?? recipe.tags ?? [];
  if (typeof tags === 'string') tags = tags.split(/[,;]/).map(tag => tag.trim()).filter(Boolean);
  else if (!Array.isArray(tags)) tags = tags ? [String(tags)] : [];
  tags = tags.map(normal).filter(Boolean);
  const photo = recipePhotoPath(recipePath, metadata);
  const warning = frontMatterWarning || recipe.warning || null;

  return {
    id: relativeId, title, tags, metadata: safeMetadata(metadata),
    ingredients: recipe.ingredients || [], cookware: recipe.cookware || [], timers: recipe.timers || [],
    steps: recipe.steps || [], notes: recipe.notes || [], sections: recipe.sections || [], warning,
    photo_available: Boolean(photo), photo_version: photoVersion(photo),
    source_name: path.basename(recipePath), source,
  };
}

function parseUncachedPaths(entries) {
  if (!entries.length) return;
  try {
    const prepared = entries.map(([recipePath, signature]) => ({ ...prepareParserInput(recipePath), recipePath, signature }));
    const results = new Map(parseBatch(prepared.map(item => item.request)).map(result => [result.id, result]));
    for (const item of prepared) {
      const result = results.get(item.relativeId) || { error: 'The parser returned no result.' };
      const recipe = finishRecipe(item.recipePath, item.source, item.metadata, item.warning, result);
      parsedRecipes.set(item.relativeId, { signature: item.signature, recipe });
      writeRecipeCache(item.relativeId, item.signature, recipe);
    }
  } catch (error) {
    console.log(`Cooklang parser batch failed: ${error?.name || 'Error'}`);
    for (const [recipePath, signature] of entries) {
      const relativeId = path.relative(ROOT, recipePath).split(path.sep).join('/');
      const memory = parsedRecipes.get(relativeId);
      if (memory && JSON.stringify(memory.signature) === JSON.stringify(signature)) continue;
      let source = '';
      try { source = fs.readFileSync(recipePath, 'utf8'); } catch { /* Unreadable recipe. */ }
      const { metadata, warning } = splitFrontMatter(source);
      const recipe = finishRecipe(recipePath, source, metadata, warning, { error: `Parser service failed (${error?.name || 'Error'})` });
      parsedRecipes.set(relativeId, { signature, recipe, retry: true });
    }
  }
}

function refreshPhotoFields(recipe, recipePath) {
  const result = { ...recipe };
  const photo = recipePhotoPath(recipePath, result.metadata);
  result.photo_available = Boolean(photo);
  result.photo_version = photoVersion(photo);
  return result;
}

function parseRecipe(recipePath) {
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
  return loadRecipeLibrary().map(recipe => ({
    id: recipe.id, title: recipe.title, tags: recipe.tags,
    ingredient_count: recipe.ingredients.length, step_count: recipe.steps.length,
    photo_available: recipe.photo_available, photo_version: recipe.photo_version || '',
    ...(recipe.warning ? { warning: recipe.warning } : {}),
  }));
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
      const source = fs.readFileSync(recipePath, 'utf8');
      const { metadata } = splitFrontMatter(source);
      const photo = recipePhotoPath(recipePath, metadata);
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
    const recipePath = recipePathFromId(id);
    if (!recipePath) { sendJson(res, { error: 'Recipe not found.' }, 404); return; }
    try {
      sendJson(res, parseRecipe(recipePath));
    } catch (error) {
      let source = '';
      try { source = fs.readFileSync(recipePath, 'utf8'); } catch { /* Keep fallback response useful. */ }
      sendJson(res, {
        id, title: recipeDisplayName(recipePath) || 'Untitled recipe', tags: [], metadata: {},
        ingredients: [], cookware: [], timers: [], steps: [], notes: [], sections: [],
        warning: `Could not parse this file (${error?.name || 'Error'}).`,
        photo_available: false, photo_version: '', source,
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
