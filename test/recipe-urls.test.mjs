import test from 'node:test';
import assert from 'node:assert/strict';
import { firstRecipeByUrlId, recipeUrlId } from '../recipe-urls.mjs';

test('removes recipe suffixes while preserving subdirectories', () => {
  assert.equal(recipeUrlId('chicken-breast-with-pearl-couscous.cook.txt'), 'chicken-breast-with-pearl-couscous');
  assert.equal(recipeUrlId('pancakes.cook'), 'pancakes');
  assert.equal(recipeUrlId('soup.txt'), 'soup');
  assert.equal(recipeUrlId('dinner/stew.cook.txt'), 'dinner/stew');
  assert.equal(recipeUrlId('breakfast/WAFFLES.COOK.TXT'), 'breakfast/WAFFLES');
});

test('uses the first inventory entry when multiple files share an extensionless URL', () => {
  const lookup = firstRecipeByUrlId(['pie.cook', 'pie.txt', 'dinner/pie.cook.txt']);
  assert.equal(lookup.get('pie'), 'pie.cook');
  assert.equal(lookup.get('dinner/pie'), 'dinner/pie.cook.txt');
  assert.equal(lookup.size, 2);
});
