import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePublishedGvcs, validateSourceLock, treeHash } from '../scripts/validate_gvcs_release.mjs';

let passed = 0; let failed = 0;
const test = (name, fn) => {
  try { fn(); passed++; }
  catch (error) { failed++; console.error(`FAIL ${name}: ${error.stack || error}`); }
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };

const root = mkdtempSync(join(tmpdir(), 'iconic-gvcs-release-'));
try {
  const webRoot = join(root, 'web');
  const release = 'build123';
  const releaseRoot = join(webRoot, 'assets', 'gvcs', 'releases', release, 'fixture');
  mkdirSync(releaseRoot, { recursive: true });
  writeFileSync(join(releaseRoot, 'part.mesh.json'), '{"vertices":[0,0,0],"triangles":[0,0,0]}');
  writeFileSync(join(releaseRoot, 'part.brp'), 'BREP fixture');
  const lock = { version: 1, repository: 'OpenSourceEcology/vcs-library',
    revision: '1234567890abcdef1234567890abcdef12345678', collection: 'collections/gvcs' };
  const catalog = { version: 1, units: 'mm', entries: [{
    id: 'fixture', title: 'Fixture', family: 'test', variant: 'one',
    description: 'Release gate fixture', source_url: 'https://example.test/source',
    source_revision: 'r1', license_review: 'pending',
    validation: { geometry: 'passed', engineering: 'unreviewed' },
    bounds_mm: [1, 2, 3], parts: [{ id: 'part', label: 'Part', color: '#112233',
      mesh: `assets/gvcs/releases/${release}/fixture/part.mesh.json`,
      brep: `assets/gvcs/releases/${release}/fixture/part.brp` }],
  }], demos: [] };
  const receipt = { status: 'passed', build_id: release, entries: ['fixture'],
    toolchain: { library_git_commit: lock.revision }, source_lock: lock,
    outputs: { assets_tree_sha256: treeHash(join(webRoot, 'assets', 'gvcs', 'releases', release)) } };

  test('accepts a pinned receipt, valid catalog, and complete hashed asset tree', () => {
    assert(validatePublishedGvcs({ lock, catalog, receipt, webRoot }).length === 0,
      'expected a valid generated release');
  });
  test('rejects missing referenced assets before upload', () => {
    const broken = structuredClone(catalog);
    broken.entries[0].parts[0].brep = `assets/gvcs/releases/${release}/fixture/missing.brp`;
    assert(validatePublishedGvcs({ lock, catalog: broken, receipt, webRoot })
      .some(error => error.includes('Referenced asset is missing')), 'missing asset was accepted');
  });
  test('rejects receipt provenance that differs from the lock', () => {
    const broken = structuredClone(receipt);
    broken.toolchain.library_git_commit = 'abcdef1234567890abcdef1234567890abcdef12';
    assert(validatePublishedGvcs({ lock, catalog, receipt: broken, webRoot })
      .some(error => error.includes('source commit differs')), 'wrong source commit was accepted');
  });
  test('requires a full immutable commit in the source lock', () => {
    assert(validateSourceLock({ ...lock, revision: 'main' })
      .some(error => error.includes('full lowercase Git commit SHA')), 'moving ref was accepted');
  });
  test('checked-in source lock is immutable and points at the canonical collection', () => {
    const checkedIn = JSON.parse(readFileSync(new URL('../gvcs-source-lock.json', import.meta.url)));
    assert(validateSourceLock(checkedIn).length === 0, 'checked-in source lock is invalid');
    assert(checkedIn.repository === 'OpenSourceEcology/vcs-library', 'wrong source repository');
    assert(checkedIn.collection === 'collections/gvcs', 'wrong source collection');
  });
  test('Pages builds and validates the pinned release before artifact upload', () => {
    const workflow = readFileSync(new URL('../.github/workflows/publish-app.yml', import.meta.url), 'utf8');
    const build = workflow.indexOf('build_release.py');
    const validate = workflow.indexOf('Validate publish catalog, provenance, and referenced assets');
    const upload = workflow.indexOf('actions/upload-pages-artifact@v3');
    const deploy = workflow.indexOf('actions/deploy-pages@v4');
    assert(build >= 0 && validate > build && upload > validate && deploy > upload,
      'build/validate/upload/deploy order is not fail-closed');
    assert(!/uses:\s*actions\/setup-python/.test(workflow),
      'Pages workflow must use system Python for PPA FreeCAD');
  });
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
