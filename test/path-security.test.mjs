import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveExistingWithin, resolveRecipeId } from '../path-security.mjs';

const suffixes = ['.cook.txt', '.cook', '.txt'];
let sandbox;
let root;
let outside;

test.before(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'cooklang-path-security-'));
  root = path.join(sandbox, 'recipes');
  outside = path.join(sandbox, 'outside');
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(root, 'safe.cook'), 'salt @salt{1%tsp}');
  fs.writeFileSync(path.join(root, 'nested', 'soup.txt'), 'Soup recipe');
  fs.writeFileSync(path.join(root, 'nested', 'WAFFLES.COOK.TXT'), 'Waffles');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'DO NOT SERVE');
  try { fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'external.txt')); }
  catch (error) { if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error; }
  try { fs.symlinkSync(path.join(root, 'safe.cook'), path.join(root, 'internal-link.cook')); }
  catch (error) { if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error; }
});

test.after(() => {
  if (sandbox) fs.rmSync(sandbox, { recursive: true, force: true });
});

test('permits valid recipe files and nested recipe IDs', () => {
  assert.equal(resolveRecipeId(root, 'safe.cook', suffixes, 1024), path.join(root, 'safe.cook'));
  assert.equal(resolveRecipeId(root, 'nested/soup.txt', suffixes, 1024), path.join(root, 'nested', 'soup.txt'));
  assert.equal(resolveRecipeId(root, 'nested/WAFFLES.COOK.TXT', suffixes, 1024), path.join(root, 'nested', 'WAFFLES.COOK.TXT'));
});

test('rejects traversal, tilde traversal, absolute paths, and malformed IDs', () => {
  const attacks = [
    '../outside/secret.txt',
    './../etc/hosts.cook',
    '~/../../etc/hostname.txt',
    '~/../../etc/hostname.cook',
    '../../etc/passwd.txt',
    '/etc/passwd.txt',
    'C:\\Windows\\win.ini.txt',
    '..\\outside\\secret.txt',
    'nested/../safe.cook',
    'nested//soup.txt',
    'nested/./soup.txt',
    'nested/nope.md',
    `safe.cook\0.txt`,
  ];
  for (const id of attacks) assert.equal(resolveRecipeId(root, id, suffixes, 1024), null, `should reject ${JSON.stringify(id)}`);
});

test('rejects symbolic links whose target leaves the recipe root', () => {
  const link = path.join(root, 'external.txt');
  if (fs.existsSync(link)) assert.equal(resolveRecipeId(root, 'external.txt', suffixes, 1024), null);
});

test('canonicalizes an internal symbolic link and rejects oversized files', () => {
  const link = path.join(root, 'internal-link.cook');
  if (fs.existsSync(link)) assert.equal(resolveRecipeId(root, 'internal-link.cook', suffixes, 1024), path.join(root, 'safe.cook'));
  assert.equal(resolveRecipeId(root, 'safe.cook', suffixes, 1), null);
});

test('generic confined resolver checks lexical and canonical containment', () => {
  assert.equal(resolveExistingWithin(root, path.join(root, 'safe.cook')), path.join(root, 'safe.cook'));
  assert.equal(resolveExistingWithin(root, path.join(outside, 'secret.txt')), null);
  const link = path.join(root, 'external.txt');
  if (fs.existsSync(link)) assert.equal(resolveExistingWithin(root, link), null);
});
