// =====================================================
// SERIALIZE — PURE document -> file object for Save/Export. No DOM, no
// three.js: split out of io.js so the save format is unit-testable
// (tests/sol15_props_roundtrip.mjs). load.js is its inverse.
// =====================================================

// includeMeta: Export adds a metadata block; Save does not.
export function serializeDoc(doc, includeMeta) {

  const out = {
    version: doc.version,
    units: doc.units,
    levels: doc.levels,
    layers: doc.layers,
    project: doc.project, // write-once setup intent (options.js); see state.js

    entities: doc.entities.map(p => p.kind === 'foundation'
      // Foundation is a derived entity: it carries params, not a module ref.
      ? { id: p.id, kind: p.kind, layer: p.layer, level: p.level, params: p.params }
      : {
      id: p.id,
      kind: p.kind,
      module: p.mod.id,
      system: p.system || doc.project.system || 'seh',
      direction: p.dir,
      x_mm: Math.round(p.x_mm * 100) / 100,
      y_mm: Math.round(p.y_mm * 100) / 100,
      level: p.level,
      layer: p.layer,
      width_mm: p.mod.width_mm,
      depth_mm: p.mod.depth_mm,
      ...(p.owner ? { owner: p.owner } : {}),
      ...(p.connections && p.connections.length > 0 ? { connections: p.connections } : {}),
      // SOL-15: props carry assembly provenance (props.assembly.module) that
      // composeAssembly needs; load.js restores them.
      ...(p.props && Object.keys(p.props).length > 0 ? { props: p.props } : {}),
    }),
  };
  if (includeMeta) {
    out.metadata = { exported: new Date().toISOString(), count: doc.entities.length };
  }
  return out;
}
