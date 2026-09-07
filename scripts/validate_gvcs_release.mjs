#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCatalog } from '../web/js/machine-core.js';

const SHA = /^[0-9a-f]{40}$/;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const COLLECTION = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

export function validateSourceLock(lock) {
  const errors = [];
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) errors.push('Source lock must be an object.');
  if (lock?.version !== 1) errors.push('Source lock version must be 1.');
  if (typeof lock?.repository !== 'string' || !REPOSITORY.test(lock.repository)) errors.push('Source lock repository must be owner/name.');
  if (typeof lock?.revision !== 'string' || !SHA.test(lock.revision)) errors.push('Source lock revision must be a full lowercase Git commit SHA.');
  if (typeof lock?.collection !== 'string' || !COLLECTION.test(lock.collection) || lock.collection.split('/').includes('..')) errors.push('Source lock collection must be a safe repository-relative path.');
  const keys = lock && typeof lock === 'object' && !Array.isArray(lock) ? Object.keys(lock).sort() : [];
  if (keys.join(',') !== 'collection,repository,revision,version') errors.push('Source lock has unknown or missing fields.');
  return errors;
}

function json(path, label) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) { throw new Error(`${label} is not valid JSON: ${error.message}`); }
}

function filesBelow(root) {
  const result = [];
  for (const name of readdirSync(root)) {
    const path = resolve(root, name);
    if (statSync(path).isDirectory()) result.push(...filesBelow(path));
    else result.push(path);
  }
  return result.sort();
}

export function treeHash(root) {
  const digest = createHash('sha256');
  for (const path of filesBelow(root)) {
    digest.update(relative(root, path).split(sep).join('/'));
    digest.update('\0');
    digest.update(createHash('sha256').update(readFileSync(path)).digest());
  }
  return digest.digest('hex');
}

function safeWebAsset(webRoot, asset) {
  if (typeof asset !== 'string' || isAbsolute(asset) || asset.includes('\\')) return null;
  const pieces = asset.split('/');
  if (pieces.some(piece => !piece || piece === '.' || piece === '..')) return null;
  const path = resolve(webRoot, ...pieces);
  const prefix = resolve(webRoot) + sep;
  return path.startsWith(prefix) ? path : null;
}

export function validatePublishedGvcs({ lock, catalog, receipt, webRoot, sourceCheckout }) {
  const errors = validateSourceLock(lock);
  const contract = validateCatalog(catalog);
  errors.push(...contract.errors.map(error => `Catalog: ${error}`));
  if (receipt?.status !== 'passed') errors.push('Build receipt status must be passed.');
  if (receipt?.toolchain?.library_git_commit !== lock?.revision) errors.push('Build receipt source commit differs from the source lock.');
  if (JSON.stringify(receipt?.source_lock) !== JSON.stringify(lock)) errors.push('Build receipt does not contain the exact source lock.');

  if (sourceCheckout) {
    try {
      const head = execFileSync('git', ['-C', sourceCheckout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      if (head !== lock.revision) errors.push('Checked-out source commit differs from the source lock.');
      if (!existsSync(resolve(sourceCheckout, lock.collection, 'scripts/build_release.py'))) errors.push('Locked collection has no release script.');
    } catch (error) { errors.push(`Could not verify source checkout: ${error.message}`); }
  }

  const catalogIds = (Array.isArray(catalog?.entries) ? catalog.entries : []).map(entry => entry?.id).sort();
  const receiptIds = Array.isArray(receipt?.entries) ? [...receipt.entries].sort() : [];
  if (JSON.stringify(catalogIds) !== JSON.stringify(receiptIds)) errors.push('Catalog entry IDs differ from the build receipt.');

  const assets = [];
  for (const entry of (Array.isArray(catalog?.entries) ? catalog.entries : [])) {
    for (const part of (Array.isArray(entry?.parts) ? entry.parts : [])) {
      assets.push(part.mesh, part.brep);
    }
  }
  const releases = new Set();
  for (const asset of assets) {
    const match = typeof asset === 'string' && asset.match(/^assets\/gvcs\/releases\/([^/]+)\//);
    if (!match) { errors.push(`Asset is not in a versioned GVCS release: ${String(asset)}`); continue; }
    releases.add(match[1]);
    const path = safeWebAsset(webRoot, asset);
    if (!path || !existsSync(path) || !statSync(path).isFile()) errors.push(`Referenced asset is missing: ${asset}`);
  }
  if (releases.size !== 1) errors.push('Catalog must reference exactly one GVCS asset release.');
  const [release] = releases;
  if (release && receipt?.build_id !== release) errors.push('Catalog asset release differs from receipt build_id.');
  const releaseRoot = release ? resolve(webRoot, 'assets', 'gvcs', 'releases', release) : null;
  if (releaseRoot && existsSync(releaseRoot)) {
    const actualHash = treeHash(releaseRoot);
    if (receipt?.outputs?.assets_tree_sha256 !== actualHash) errors.push('Published asset tree hash differs from the build receipt.');
  }
  return errors;
}

function option(name) {
  const at = process.argv.indexOf(name);
  return at < 0 ? null : process.argv[at + 1];
}

function main() {
  const lockPath = resolve(option('--lock') || 'gvcs-source-lock.json');
  const lock = json(lockPath, 'Source lock');
  const lockErrors = validateSourceLock(lock);
  if (lockErrors.length) throw new Error(lockErrors.join('\n'));
  if (process.argv.includes('--lock-only')) {
    console.log(`GVCS source lock valid: ${lock.repository}@${lock.revision} ${lock.collection}`);
    return;
  }
  const webRoot = resolve(option('--web') || 'web');
  const receiptPath = resolve(option('--receipt') || resolve(webRoot, 'data/gvcs-build-receipt.json'));
  const catalogPath = resolve(webRoot, 'data/gvcs-machines.json');
  const receipt = json(receiptPath, 'Build receipt');
  if (process.argv.includes('--stamp-receipt')) {
    receipt.source_lock = lock;
    writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  }
  const errors = validatePublishedGvcs({
    lock, catalog: json(catalogPath, 'GVCS catalog'), receipt,
    webRoot, sourceCheckout: option('--source-checkout'),
  });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`GVCS release valid: ${receipt.build_id}, ${receipt.entries.length} entries, ${new Set(receipt.entries).size} unique IDs`);
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`GVCS RELEASE INVALID\n${error.message}`); process.exitCode = 1; }
}
