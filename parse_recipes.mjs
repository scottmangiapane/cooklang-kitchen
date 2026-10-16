#!/usr/bin/env node
/**
 * Cooklang AST adapter for Cooklang Kitchen.
 *
 * Cooklang syntax is parsed by the official @cooklang/cooklang WASM package.
 * This module maps the AST into the small JSON contract consumed by server.mjs.
 * Batches are parsed in-process so the backend needs no subprocess or second runtime.
 */
import {
  Parser,
  ingredient_display_name,
  ingredient_should_be_listed,
  cookware_display_name,
  cookware_should_be_listed,
  quantity_display,
  grouped_quantity_display,
  grouped_quantity_is_empty,
} from '@cooklang/cooklang';

const parser = new Parser();
const normal = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const keyName = value => normal(value).toLocaleLowerCase();

function plainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value));
}

function amountText(quantity) {
  if (!quantity) return '';
  try { return normal(quantity_display(quantity)); }
  catch { return ''; }
}

function parseAmount(text) {
  const match = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?)(?:\s+(.*?))?\s*$/.exec(String(text ?? ''));
  if (!match) return null;
  const raw = match[1].trim();
  let value;
  let fraction = /^(\d+)\s+(\d+)\/(\d+)$/.exec(raw);
  if (fraction) value = Number(fraction[1]) + Number(fraction[2]) / Number(fraction[3]);
  else if ((fraction = /^(\d+)\/(\d+)$/.exec(raw))) value = Number(fraction[1]) / Number(fraction[2]);
  else value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return { value, unit: normal(match[2] || '') };
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return String(value);
  const whole = Math.floor(value + 1e-8);
  const fraction = value - whole;
  if (fraction < 0.012) return String(whole);
  const denominators = [2, 3, 4, 5, 6, 8, 10, 12, 16];
  let best = null;
  for (const denominator of denominators) {
    const numerator = Math.round(fraction * denominator);
    const error = Math.abs(fraction - numerator / denominator);
    if (!best || error < best.error) best = { denominator, numerator, error };
  }
  if (best && best.error < 0.012) {
    if (best.numerator === best.denominator) return String(whole + 1);
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const divisor = gcd(best.numerator, best.denominator);
    const part = `${best.numerator / divisor}/${best.denominator / divisor}`;
    return whole ? `${whole} ${part}` : part;
  }
  return String(Math.round(value * 100) / 100);
}

// The official public TypeScript API currently omits a direct optional-modifier
// accessor. Retain that small piece of presentation metadata without attempting
// to tokenize or parse Cooklang itself here.
function optionalNameCounts(source) {
  const counts = new Map();
  const text = String(source ?? '');
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== '@' || text[i + 1] !== '?') continue;
    let start = i + 2;
    let end = start;
    while (end < text.length && !'@#~\r\n'.includes(text[end]) && text[end] !== '{' && text[end] !== '}') end++;
    const name = normal(text.slice(start, end));
    if (!name) continue;
    const key = keyName(name);
    counts.set(key, (counts.get(key) || 0) + 1);
    i = end - 1;
  }
  return counts;
}

function optionalFlags(source, ingredients) {
  const counts = optionalNameCounts(source);
  return ingredients.map(ingredient => {
    const key = keyName(ingredient?.name);
    const count = counts.get(key) || 0;
    if (count) {
      counts.set(key, count - 1);
      return true;
    }
    return false;
  });
}

function groupedComponents(parsed, components, groupMethod) {
  // Grouping in cooklang-rs follows explicit Cooklang ingredient/cookware
  // references. The additional name-based merge below handles separate
  // declarations that happen to name the same ingredient.
  try {
    if (typeof parser[groupMethod] === 'function') {
      const grouped = parser[groupMethod](parsed);
      if (Array.isArray(grouped) && (grouped.length > 0 || components.length === 0)) {
        return grouped.map(entry => {
          const index = Number(entry.index);
          const component = components[index];
          if (!component) return null;
          let quantity = amountText(component.quantity);
          try {
            if (entry.quantity && !grouped_quantity_is_empty(entry.quantity)) {
              quantity = normal(grouped_quantity_display(entry.quantity));
            }
          } catch { /* keep the source quantity if grouped formatting is unavailable */ }
          return { component, index, quantity };
        }).filter(Boolean);
      }
    }
  } catch { /* fall back to the component list on API differences */ }
  return components.map((component, index) => ({ component, index, quantity: amountText(component.quantity) }));
}

function makeIngredientList(ingredients, optionalByIndex, parsed) {
  const rows = [];
  const byKey = new Map();
  const entries = groupedComponents(parsed, ingredients, 'group_ingredients');
  for (const { component: ingredient, index, quantity } of entries) {
    let listed = true;
    try { listed = ingredient_should_be_listed(ingredient); } catch { /* tolerate API differences */ }
    if (!listed) continue;

    const name = normal(ingredient_display_name(ingredient) || ingredient.name);
    if (!name) continue;
    const preparation = normal(ingredient.note || '');
    const optional = Boolean(optionalByIndex[index]);
    const parsedAmount = parseAmount(quantity);
    const baseKey = [keyName(name), keyName(preparation), optional ? 'optional' : 'required'].join('\u0001');
    const groupKey = parsedAmount
      ? `${baseKey}\u0001number\u0001${keyName(parsedAmount.unit)}`
      : `${baseKey}\u0001text\u0001${keyName(quantity)}`;

    const existing = byKey.get(groupKey);
    if (existing) {
      // Add numeric quantities that have the same unit. Text quantities and
      // ranges are deduplicated rather than added because they aren't numeric.
      if (parsedAmount && existing.numeric !== null) {
        existing.numeric += parsedAmount.value;
        existing.item.quantity = `${formatAmount(existing.numeric)}${existing.unit ? ` ${existing.unit}` : ''}`;
        existing.item.display_quantity = existing.item.quantity;
      }
      continue;
    }

    const item = {
      name,
      quantity,
      unit: '',
      optional,
      preparation,
      display_quantity: quantity,
    };
    rows.push(item);
    byKey.set(groupKey, {
      item,
      numeric: parsedAmount ? parsedAmount.value : null,
      unit: parsedAmount?.unit || '',
    });
  }
  return rows;
}

function makeCookwareList(cookware, parsed) {
  const result = [];
  const seen = new Set();
  const entries = groupedComponents(parsed, cookware, 'group_cookware');
  for (const { component: item, quantity } of entries) {
    let listed = true;
    try { listed = cookware_should_be_listed(item); } catch { /* tolerate API differences */ }
    if (!listed) continue;
    const name = normal(cookware_display_name(item) || item.name);
    const preparation = normal(item.note || '');
    const key = [keyName(name), keyName(quantity), keyName(preparation)].join('\u0001');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    result.push({ name, quantity, unit: '', optional: false, preparation, display_quantity: quantity });
  }
  return result;
}

function makeTimers(timers) {
  const result = [];
  const seen = new Set();
  for (const timer of timers) {
    const name = normal(timer.name || 'Timer');
    const quantity = amountText(timer.quantity);
    const key = [keyName(name), keyName(quantity)].join('\u0001');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ name, quantity, unit: '', optional: false, preparation: '', display_quantity: quantity });
  }
  return result;
}

function componentPart(type, component, index, optionalByIndex) {
  if (!component) return { type: 'text', text: '' };
  if (type === 'ingredient') {
    const name = normal(ingredient_display_name(component) || component.name) || 'Unnamed ingredient';
    return {
      type,
      name,
      quantity: amountText(component.quantity),
      unit: '',
      preparation: normal(component.note || ''),
      optional: Boolean(optionalByIndex[index]),
      raw_amount: amountText(component.quantity),
    };
  }
  if (type === 'cookware') {
    const name = normal(cookware_display_name(component) || component.name) || 'Unnamed cookware';
    return { type, name, quantity: amountText(component.quantity), unit: '', preparation: normal(component.note || ''), optional: false };
  }
  if (type === 'timer') {
    return { type, name: normal(component.name || 'Timer'), quantity: amountText(component.quantity), unit: '' };
  }
  return { type: 'text', text: '' };
}

function partsFromContent(content, ast, optionalByIndex) {
  if (content?.type === 'text') return [{ type: 'text', text: String(content.value ?? '') }];
  if (content?.type !== 'step') return [];
  const parts = [];
  for (const item of (content.value?.items || [])) {
    switch (item.type) {
      case 'text':
        parts.push({ type: 'text', text: String(item.value ?? '') });
        break;
      case 'ingredient':
        parts.push(componentPart('ingredient', ast.ingredients?.[item.index], item.index, optionalByIndex));
        break;
      case 'cookware':
        parts.push(componentPart('cookware', ast.cookware?.[item.index], item.index, []));
        break;
      case 'timer':
        parts.push(componentPart('timer', ast.timers?.[item.index], item.index, []));
        break;
      case 'inlineQuantity': {
        const value = ast.inline_quantities?.[item.index];
        parts.push({ type: 'text', text: amountText(value) });
        break;
      }
      default:
        break;
    }
  }
  return parts;
}

function partsToText(parts) {
  return parts.map(part => {
    if (part.type === 'text') return part.text;
    if (part.type === 'ingredient') return `${part.name}${part.quantity ? ` (${part.quantity})` : ''}`;
    if (part.type === 'cookware') return part.name;
    if (part.type === 'timer') return `${part.name === 'Timer' ? '' : part.name} ${part.quantity || ''}`.trim();
    return '';
  }).join('');
}

function parseNote(noteText) {
  const parsed = parser.parse(String(noteText ?? ''));
  const ast = parsed?.recipe || parsed;
  const optionalByIndex = optionalFlags(noteText, ast.ingredients || []);
  const parts = [];
  for (const section of (ast.sections || [])) {
    for (const content of (section.content || [])) {
      parts.push(...partsFromContent(content, ast, optionalByIndex));
    }
  }
  if (!parts.length && noteText) parts.push({ type: 'text', text: noteText });
  return { text: partsToText(parts), parts };
}

function parseOne(input) {
  const parsed = parser.parse(String(input.source ?? ''));
  const ast = parsed?.recipe || parsed;
  if (!ast || !Array.isArray(ast.sections)) throw new Error('The official parser returned an unexpected recipe structure.');

  const ingredients = ast.ingredients || [];
  const cookware = ast.cookware || [];
  const timers = ast.timers || [];
  const optionalByIndex = optionalFlags(input.source, ingredients);
  const steps = [];
  const sections = [];

  for (const section of ast.sections) {
    const sectionName = normal(section.name || '');
    if (sectionName && !sections.includes(sectionName)) sections.push(sectionName);
    for (const content of (section.content || [])) {
      const parts = partsFromContent(content, ast, optionalByIndex);
      if (!parts.length) continue;
      const text = partsToText(parts).trim();
      if (!text) continue;
      // Keep text-only paragraphs visible just as the old recipe browser did.
      steps.push({ text, parts, section: sectionName });
    }
  }

  const rawMetadata = plainObject(ast.raw_metadata?.map || ast.metadata?.map || {});
  const interpreted = parsed?.metadata || {};
  if (!Object.hasOwn(rawMetadata, 'title') && interpreted.title) rawMetadata.title = interpreted.title;
  if (!Object.hasOwn(rawMetadata, 'tags') && Array.isArray(interpreted.tags) && interpreted.tags.length) rawMetadata.tags = interpreted.tags;
  if (!Object.hasOwn(rawMetadata, 'servings') && interpreted.servings != null) rawMetadata.servings = interpreted.servings;

  return {
    id: input.id,
    title: normal(rawMetadata.title || input.fallback_title || 'Untitled recipe') || 'Untitled recipe',
    tags: rawMetadata.tags || [],
    metadata: rawMetadata,
    ingredients: makeIngredientList(ingredients, optionalByIndex, parsed),
    cookware: makeCookwareList(cookware, parsed),
    timers: makeTimers(timers),
    steps,
    notes: (input.notes || []).map(parseNote),
    sections,
    warning: input.front_matter_warning || null,
  };
}

export function parseBatch(requests) {
  return requests.map(request => {
    try { return { id: request.id, recipe: parseOne(request) }; }
    catch (error) { return { id: request.id, error: String(error?.message || error) }; }
  });
}
