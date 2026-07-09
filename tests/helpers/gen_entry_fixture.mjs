import { buildEntryFiles } from '../../web/js/entry_files.js';

const schema = {
  schema_name: 'Generated_Test_Assembly',
  units: 'in',
  document_name: 'Generated_Test_Assembly',
  name: 'Generated Test Assembly',
  floor: { width_in: 96, depth_in: 48 },
  common_wall: { module_width_in: 48, stud_spacing_in: 24, lumber: '2x6' },
  walls: [
    { name: 'Front_Wall', side: 'front', modules: [{ type: 'standard' }, { type: 'window' }] },
  ],
};

const files = buildEntryFiles(schema, { id: 'generated_test_assembly', title: 'Generated Test Assembly', owner: 'Tester', system: 'vcs12' }, {
  bbox_in: { x: [0, 96], y: [0, 48], z: [0, 104] },
  solidsLowerBound: 4,
});

process.stdout.write(JSON.stringify(files));
