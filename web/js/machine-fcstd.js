// A deliberately small FCStd writer for pre-baked machine BREP payloads. The
// browser never creates geometry: it appends a rigid OCCT Location to each
// source BREP and leaves the XML object Placement at identity. FreeCAD restores
// Shape after XML properties, so using object Placement would be overwritten.
import { validateMachineWorkspace, rotationMatrixXYZ } from './machine-core.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const safeName = value => String(value).replace(/[^A-Za-z0-9_]/g, '_');
const g = value => (+Number(value).toPrecision(15)).toString();

export function zPlacement(position, rotationDeg) {
  const radians = rotationDeg * Math.PI / 180;
  return { x: position[0], y: position[1], z: position[2], q0: 0, q1: 0, q2: Math.sin(radians / 2), q3: Math.cos(radians / 2), angle: rotationDeg };
}

const identityPlacement = () => ({ x: 0, y: 0, z: 0, q0: 0, q1: 0, q2: 0, q3: 1, angle: 0 });

// Append a rigid world-space transform to a textual OCCT BREP Location table.
// The composite Location uses the same old-location + appended-transform order
// as fcstd.js's proven translateBrep: it applies the new transform *after* the
// baked top Location. That preserves source-local rotations/translations rather
// than replacing the BREP's top Location.
export { rotationMatrixXYZ } from './machine-core.js';

export function rigidZTransformBrep(text, position, rotationDeg) {
  return rigidTransformBrep(text, position, [0, 0, rotationDeg]);
}

export function rigidTransformBrep(text, position, rotationXYZ) {
  if (typeof text !== 'string') throw new Error('BREP must be text.');
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite) || !Array.isArray(rotationXYZ) || rotationXYZ.length !== 3 || !rotationXYZ.every(Number.isFinite)) throw new Error('BREP transform needs finite XYZ coordinates and XYZ rotations.');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const locationLine = lines.findIndex(line => /^Locations\s+\d+\s*$/.test(line));
  if (locationLine < 0) throw new Error('BREP has no readable Locations header.');
  const countMatch = lines[locationLine].match(/^Locations\s+(\d+)\s*$/);
  const count = Number(countMatch[1]);
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('BREP Locations count is invalid.');
  let insertAt = locationLine + 1;
  for (let index = 0; index < count; index++) {
    const flag = lines[insertAt]?.trim();
    if (flag === '1') {
      const matrixLines = lines.slice(insertAt + 1, insertAt + 4);
      if (matrixLines.length !== 3 || !matrixLines.every(line => line.trim().split(/\s+/).length === 4 && line.trim().split(/\s+/).every(value => Number.isFinite(Number(value))))) throw new Error(`BREP Location ${index + 1} has an unreadable transform.`);
      insertAt += 4;
    } else if (/^2(?:\s+-?\d+)+\s*$/.test(flag || '')) {
      insertAt += 1;
    } else {
      throw new Error(`BREP Location ${index + 1} has an unknown encoding.`);
    }
  }
  const finalLine = [...lines.keys()].reverse().find(index => lines[index].trim() !== '');
  const topMatch = finalLine == null ? null : lines[finalLine].match(/^\+(\d+)\s+(\d+)\s*$/);
  if (!topMatch) throw new Error('BREP has no readable top-shape location.');
  const shapeId = Number(topMatch[1]);
  const topLocation = Number(topMatch[2]);
  if (!Number.isSafeInteger(shapeId) || shapeId < 1 || !Number.isSafeInteger(topLocation) || topLocation < 0 || topLocation > count) throw new Error('BREP top-shape location is invalid.');

  const values = rotationMatrixXYZ(...rotationXYZ);
  const matrix = [values.slice(0,3), values.slice(3,6), values.slice(6,9)];
  const clean = value => Math.abs(value) < 1e-14 ? 0 : value;
  const transform = ['1', ...matrix.map((row, index) =>
    `              ${g(clean(row[0]))}               ${g(clean(row[1]))}               ${g(clean(row[2]))} ${g(position[index])} `)];
  const transformIndex = count + 1;
  let replacementTop;
  let inserted;
  if (topLocation === 0) { replacementTop = transformIndex; inserted = transform; }
  else { replacementTop = count + 2; inserted = [...transform, `2 ${topLocation} 1 ${transformIndex} 1 0`]; }
  lines.splice(insertAt, 0, ...inserted);
  // A primitive Location adds one table item; a composite reference adds a
  // second table item.
  lines[locationLine] = `Locations ${topLocation === 0 ? count + 1 : count + 2}`;
  lines[finalLine + inserted.length] = `+${shapeId} ${replacementTop}`;
  return `${lines.join('\n').replace(/\s+$/, '')}\n`;
}

function objectBlock(part) {
  const p = identityPlacement();
  return `        <Object name="${part.name}"><Properties Count="5" TransientCount="0">
                <Property name="Label" type="App::PropertyString" status="134217728"><String value="${esc(part.label)}"/></Property>
                <Property name="SourceURL" type="App::PropertyString"><String value="${esc(part.source_url)}"/></Property>
                <Property name="SourceRevision" type="App::PropertyString"><String value="${esc(part.source_revision)}"/></Property>
                <Property name="Placement" type="App::PropertyPlacement" status="8388608"><PropertyPlacement Px="${g(p.x)}" Py="${g(p.y)}" Pz="${g(p.z)}" Q0="${g(p.q0)}" Q1="${g(p.q1)}" Q2="${g(p.q2)}" Q3="${g(p.q3)}" A="${g(p.angle)}" Ox="0" Oy="0" Oz="1"/></Property>
                <Property name="Shape" type="Part::PropertyPartShape"><Part file="${part.name}.brp"/><ElementMap/></Property>
        </Properties></Object>\n`;
}

export function machineDocumentXml(parts) {
  const declarations = parts.map((part, index) => `        <Object type="Part::Feature" name="${part.name}" id="${2000 + index}" />\n`).join('');
  const deps = parts.map(part => `        <ObjectDeps Name="${part.name}" Count="0"/>\n`).join('');
  return `<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
    <Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString" status="16777217"><String value="Iconic CAD Machines"/></Property></Properties>
    <Objects Count="${parts.length}" Dependencies="0">
${deps}${declarations}    </Objects>
    <ObjectData Count="${parts.length}">
${parts.map(objectBlock).join('')}    </ObjectData>
</Document>\n`;
}

export function machineGuiDocumentXml(parts) {
  return `<?xml version='1.0' encoding='utf-8'?>
<!DOCTYPE GuiDocument>
<Document SchemaVersion="1"><ViewProviderData Count="${parts.length}">
${parts.map(part => `        <ViewProvider name="${part.name}" expanded="0"><Properties Count="1" TransientCount="0"><Property name="Visibility" type="App::PropertyBool"><Bool value="true"/></Property></Properties></ViewProvider>\n`).join('')}    </ViewProviderData></Document>\n`;
}

export function fcstdParts(workspace, catalog, breps) {
  const byEntry = new Map(catalog.entries.map(entry => [entry.id, entry]));
  const parts = [];
  for (const [instanceIndex, inst] of workspace.instances.entries()) {
    const entry = byEntry.get(inst.entry_id);
    for (const [partIndex, part] of entry.parts.entries()) {
      const key = part.brep;
      if (typeof breps[key] !== 'string' || !breps[key].trim()) throw new Error(`Missing source BREP for ${entry.title}: ${part.label}.`);
      parts.push({ name: `Machine_${instanceIndex + 1}_${safeName(inst.id)}_${partIndex + 1}_${safeName(part.id)}`, label: `${entry.title} — ${part.label} (${inst.id})`, source_url: entry.source_url, source_revision: entry.source_revision, position_mm: inst.position_mm, rotation_deg: inst.rotation_deg, brep: rigidTransformBrep(breps[key], inst.position_mm, [inst.rotation_x_deg ?? 0, inst.rotation_y_deg ?? 0, inst.rotation_deg]) });
    }
  }
  return parts;
}

export async function buildMachineFcstd(workspace, catalog, fetchText, JSZip) {
  const valid = validateMachineWorkspace(workspace, catalog);
  if (!valid.ok) throw new Error(valid.errors.join(' '));
  if (!workspace.instances.length) throw new Error('Place a machine before exporting FreeCAD.');
  const paths = [...new Set(workspace.instances.flatMap(inst => catalog.entries.find(entry => entry.id === inst.entry_id).parts.map(part => part.brep)))];
  const breps = Object.fromEntries(await Promise.all(paths.map(async path => [path, await fetchText(path)])));
  const parts = fcstdParts(workspace, catalog, breps);
  const zip = new JSZip();
  zip.file('Document.xml', machineDocumentXml(parts));
  for (const part of parts) zip.file(`${part.name}.brp`, part.brep);
  zip.file('GuiDocument.xml', machineGuiDocumentXml(parts));
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export const machineFcstdTest = { objectBlock, safeName };
