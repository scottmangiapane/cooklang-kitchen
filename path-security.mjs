import fs from 'node:fs';
import path from 'node:path';

export function isWithinDirectory(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/**
 * Resolve an existing path only when both its lexical and canonical target are
 * contained by `root`. The returned canonical path is the only path callers
 * should use for subsequent file operations. Symlinks that escape the root are
 * rejected. `root` must exist; a missing/unavailable root fails closed.
 */
export function resolveExistingWithin(root, candidate) {
  let canonicalRoot;
  try { canonicalRoot = fs.realpathSync(root); }
  catch { return null; }

  const absoluteCandidate = path.resolve(candidate);
  if (!isWithinDirectory(canonicalRoot, absoluteCandidate)) return null;
  try {
    const canonicalCandidate = fs.realpathSync(absoluteCandidate);
    return isWithinDirectory(canonicalRoot, canonicalCandidate) ? canonicalCandidate : null;
  } catch {
    return null;
  }
}

/** Resolve a slash-separated recipe ID beneath the recipe root, failing closed. */
export function resolveRecipeId(root, id, suffixes, maxBytes) {
  if (typeof id !== 'string' || !id || id.includes('\0')) return null;
  if (id.startsWith('/') || id.includes('\\') || path.isAbsolute(id) || path.win32.isAbsolute(id) || /^[a-z]:/i.test(id)) return null;

  const segments = id.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) return null;
  if (!suffixes.some(suffix => id.toLowerCase().endsWith(suffix))) return null;

  let canonicalRoot;
  try { canonicalRoot = fs.realpathSync(root); }
  catch { return null; }
  const candidate = path.resolve(canonicalRoot, ...segments);
  const safe = resolveExistingWithin(canonicalRoot, candidate);
  if (!safe || !suffixes.some(suffix => path.basename(safe).toLowerCase().endsWith(suffix))) return null;

  try {
    const stat = fs.statSync(safe);
    return stat.isFile() && stat.size <= maxBytes ? safe : null;
  } catch {
    return null;
  }
}
