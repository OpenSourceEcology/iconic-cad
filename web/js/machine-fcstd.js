// A deliberately small FCStd writer for pre-baked machine BREP payloads.  Each
// FreeCAD object keeps the source BREP intact and uses Placement for assembly
// translation and Z rotation; the browser never claims to create geometry.
import { validateMachineWorkspace } from './machine-core.js';

const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const safeName = value => String(value).replace(/[^A-Za-z0-9_]/g, '_');
const g = value => (+Number(value).toPrecision(15)).toString();

export function zPlacement(position, rotationDeg) {
  const radians = rotationDeg * Math.PI / 180;
  return { x: position[0], y: position[1], z: position[2], q0: 0, q1: 0, q2: Math.sin(radians / 2), q3: Math.cos(radians / 2), angle: rotationDeg };
}

function objectBlock(part) {
  const p = zPlacement(part.position_mm, part.rotation_deg);
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
      parts.push({ name: `Machine_${instanceIndex + 1}_${safeName(inst.id)}_${partIndex + 1}_${safeName(part.id)}`, label: `${entry.title} — ${part.label} (${inst.id})`, source_url: entry.source_url, source_revision: entry.source_revision, position_mm: inst.position_mm, rotation_deg: inst.rotation_deg, brep: breps[key] });
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
