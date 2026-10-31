const RECIPE_SUFFIXES = ['.cook.txt', '.cook', '.txt'];

// Public recipe URLs omit the filename suffix but keep any subdirectory.
export function recipeUrlId(fileId) {
  const lower = fileId.toLowerCase();
  const suffix = RECIPE_SUFFIXES.find(value => lower.endsWith(value));
  return suffix ? fileId.slice(0, -suffix.length) : fileId;
}

// The inventory is already sorted, so the first duplicate wins consistently.
export function firstRecipeByUrlId(fileIds) {
  const recipes = new Map();
  for (const fileId of fileIds) {
    const urlId = recipeUrlId(fileId);
    if (!recipes.has(urlId)) recipes.set(urlId, fileId);
  }
  return recipes;
}
