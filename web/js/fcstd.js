// =====================================================
// FCSTD EXPORT (browser) — exact-spec FreeCAD, no terminal.
//
// Reproduces compile_from_json.py byte-for-byte: it uses the SAME professionally
// modelled cad_library shapes (pre-baked per direction by FreeCAD: rotate +
// normalise), positions each by injecting a global translation into the BREP's
// OCCT Locations, and adds the SAME procedural blocking (C1/C2/T) for interior
// T-junctions. Verified against the compiler: per-object volumes + centres
// identical on every layout + blocking type tested.
//
// Library BREPs live in assets/lib/<module>__<dir>.brp (rotation already baked).
// =====================================================
import { doc } from './state.js';
import { IN_TO_MM } from './constants.js';

const NOMINAL_TO_ACTUAL = {
  '2x2': [1.5, 1.5], '2x3': [1.5, 2.5], '2x4': [1.5, 3.5], '2x6': [1.5, 5.5],
  '2x8': [1.5, 7.25], '2x10': [1.5, 9.25], '2x12': [1.5, 11.25],
};

// Wall specs — generated from wall_instances.yaml by scripts/gen_specs.py.
// Loaded lazily from assets/lib/specs.json on first export; do NOT hand-edit here.
// Parity contract with compile_from_json.py: tests/parity.mjs
let WALL_SPECS = null;

// %.15g-style: up to 15 significant digits, no trailing zeros.
const g15 = (v) => (+v.toPrecision(15)).toString();

// Inject a global translation into a BREP by appending OCCT Locations and
// repointing the top shape (proven equivalent to shape.translate in FreeCAD).
function translateBrep(text, tx, ty, tz) {
  const lines = text.split('\n');
  const li = lines.findIndex(l => l.startsWith('Locations '));
  const n = parseInt(lines[li].split(/\s+/)[1], 10);
  let p = li + 1;
  for (let k = 0; k < n; k++) {
    const f = lines[p].trim();
    if (f === '1') p += 4;
    else if (f.startsWith('2')) p += 1;
    else throw new Error('unknown location flag: ' + f);
  }
  const m = text.replace(/\s+$/, '').match(/\+(\d+)\s+(\d+)$/);
  const shp = +m[1], toploc = +m[2];
  const elem = ['1',
    '              1               0               0 ' + g15(tx) + ' ',
    '              0               1               0 ' + g15(ty) + ' ',
    '              0               0               1 ' + g15(tz) + ' '];
  let newcount, newtop, insert;
  if (toploc === 0) { insert = elem; newcount = n + 1; newtop = n + 1; }
  else { insert = elem.concat(['2 ' + toploc + ' 1 ' + (n + 1) + ' 1 0']); newcount = n + 2; newtop = n + 2; }
  lines.splice(p, 0, ...insert);
  lines[li] = 'Locations ' + newcount;
  let t2 = lines.join('\n').replace(/\s+$/, '');
  t2 = t2.replace(new RegExp('\\+' + shp + '\\s+' + toploc + '$'), '+' + shp + ' ' + newtop) + '\n';
  return t2;
}

// Box BREP at corner (tx,ty,tz) with dims (dx,dy,dz) — for blocking pieces.
let BOX_TEMPLATE = null;
function boxBrep(dx, dy, dz, tx, ty, tz) {
  let s = BOX_TEMPLATE;
  for (const [tok, val] of [['1111', dx], ['222', dy], ['3333', dz]]) {
    s = s.split(`${tok}.00000000000000000`).join(val.toFixed(17));
    s = s.split(`${tok}.000000000000000`).join(val.toFixed(15));
  }
  return translateBrep(s, tx, ty, tz);
}

// ---- blocking (ported verbatim from compile_from_json.create_blocking) ------
function studPositions(wIn, stIn, oc) {
  const pos = [0]; const right = wIn - stIn; let cur = oc;
  while (cur + stIn <= right) { pos.push(cur); cur += oc; }
  if (pos[pos.length - 1] !== right) pos.push(right);
  return pos;
}
function studCentersAssembled(d, tx, ty, w, studs, st) {
  return studs.map(s => {
    const c = (s + st / 2) * IN_TO_MM;
    return { north: tx + c, south: tx + w - c, east: ty + c, west: ty + w - c }[d];
  });
}
function frameDepthRange(d, tx, ty, sd, osb) {
  return { north: [ty + osb, ty + osb + sd], south: [ty, ty + sd],
           east: [tx, tx + sd], west: [tx + osb, tx + osb + sd] }[d];
}
function canonicalContact(d, w, cx, cy, wx, wy) {
  return { north: cx - wx, south: w - (cx - wx), east: cy - wy, west: w - (cy - wy) }[d];
}
function createBlocking(conn, byId, minx, miny) {
  const target = byId[conn.target_id];
  if (!target) return [];
  const tm = target.mod.id;
  let params = null;
  for (const [k, v] of Object.entries(WALL_SPECS)) {
    if (tm.startsWith(k) || k.startsWith(tm)) { params = v; break; }
  }
  if (!params) return [];
  const wIn = params.w * 12, hIn = params.h * 12;
  const [stIn, sdIn] = NOMINAL_TO_ACTUAL[params.lum];
  const osbIn = params.osb || 0, oc = params.oc;
  const w = wIn * IN_TO_MM, H = hIn * IN_TO_MM, st = stIn * IN_TO_MM, sd = sdIn * IN_TO_MM, osb = osbIn * IN_TO_MM;
  const plate = st, studH = H - 2 * plate, bt = 1.5 * IN_TO_MM, bd = 3.5 * IN_TO_MM;
  const tx = target.x_mm - minx, ty = target.y_mm - miny;
  const cx = conn.contact_x_mm - minx, cy = conn.contact_y_mm - miny;
  const d = target.dir, isH = d === 'north' || d === 'south';
  const [dmin, dmax] = frameDepthRange(d, tx, ty, sd, osb);
  const flush = (d === 'north' || d === 'west') ? dmax - bt : dmin;
  const out = [], typ = conn.blocking || 'C1', iwallHalf = bt / 2, along = isH ? cx : cy;

  if (typ === 'C2') {
    const ctrs = studCentersAssembled(d, tx, ty, w, studPositions(wIn, stIn, oc), stIn);
    const sh = stIn * IN_TO_MM / 2, rs = along + iwallHalf, ls = along - iwallHalf - bd;
    const ov = (a, b) => ctrs.some(c => a < c + sh && b > c - sh);
    if (!ov(rs, rs + bd)) out.push(isH ? [bd, bt, studH, rs, flush, plate] : [bt, bd, studH, flush, rs, plate]);
    if (!ov(ls, ls + bd)) out.push(isH ? [bd, bt, studH, ls, flush, plate] : [bt, bd, studH, flush, ls, plate]);
  } else if (typ === 'C1') {
    const ctrs = studCentersAssembled(d, tx, ty, w, studPositions(wIn, stIn, oc), stIn);
    const sh = stIn * IN_TO_MM / 2;
    const near = ctrs.reduce((a, b) => Math.abs(b - along) < Math.abs(a - along) ? b : a);
    const bs = along >= near ? near + sh : near - sh - bd;
    out.push(isH ? [bd, bt, studH, bs, flush, plate] : [bt, bd, studH, flush, bs, plate]);
  } else if (typ === 'T') {
    const cin = canonicalContact(d, w, cx + minx, cy + miny, target.x_mm, target.y_mm) / IN_TO_MM;
    const studs = studPositions(wIn, stIn, oc);
    let le = 0, rsi = wIn - stIn;
    for (const sp of studs) { if (sp + stIn <= cin) le = sp + stIn; if (sp >= cin) { rsi = sp; break; } }
    const blen = rsi - le;
    if (blen <= 0) return [];
    const blmm = blen * IN_TO_MM, lmm = le * IN_TO_MM, nb = 4, bsp = studH / (nb + 1);
    for (let i = 0; i < nb; i++) {
      const z = plate + bsp * (i + 1) - bd / 2;
      if (isH) {
        const bx = d === 'north' ? tx + lmm : tx + w - (lmm + blmm);
        out.push([blmm, bt, bd, bx, flush, z]);
      } else {
        const by = d === 'east' ? ty + lmm : ty + w - (lmm + blmm);
        out.push([bt, blmm, bd, flush, by, z]);
      }
    }
  }
  return out;
}

function objBlock(name, label) {
  return `        <Object name="${name}"><Properties Count="3" TransientCount="0">
                <Property name="Label" type="App::PropertyString" status="134217728"><String value="${label}"/></Property>
                <Property name="Placement" type="App::PropertyPlacement" status="8388608"><PropertyPlacement Px="0.0" Py="0.0" Pz="0.0" Q0="0.0" Q1="0.0" Q2="0.0" Q3="1.0" A="0.0" Ox="0.0" Oy="0.0" Oz="1.0"/></Property>
                <Property name="Shape" type="Part::PropertyPartShape"><Part file="${name}.brp"/><ElementMap/></Property>
        </Properties></Object>\n`;
}
function documentXml(objs) {
  const deps = objs.map(o => `        <ObjectDeps Name="${o.name}" Count="0"/>\n`).join('');
  const od = objs.map((o, i) => `        <Object type="Part::Feature" name="${o.name}" id="${2000 + i}" />\n`).join('');
  const data = objs.map(o => objBlock(o.name, o.label)).join('');
  return `<?xml version='1.0' encoding='utf-8'?>
<Document SchemaVersion="4" FileVersion="1">
    <Properties Count="1" TransientCount="0"><Property name="Label" type="App::PropertyString" status="16777217"><String value="IconicCAD"/></Property></Properties>
    <Objects Count="${objs.length}" Dependencies="0">
${deps}${od}    </Objects>
    <ObjectData Count="${objs.length}">
${data}    </ObjectData>
</Document>
`;
}

const brepCache = {};
async function libBrep(modId, dir) {
  const key = `${modId}__${dir}`;
  if (!brepCache[key]) brepCache[key] = await (await fetch(`assets/lib/${key}.brp`)).text();
  return brepCache[key];
}

// Exposed for the node verification harness (not used by the app).
export const _test = {
  translateBrep, createBlocking, documentXml, objBlock,
  boxBrep: (dx, dy, dz, tx, ty, tz, tmpl) => { BOX_TEMPLATE = tmpl; return boxBrep(dx, dy, dz, tx, ty, tz); },
  setWallSpecs: (s) => { WALL_SPECS = s; },
};

export async function exportFcstd() {
  const ents = doc.entities;
  if (ents.length === 0) { alert('Place some modules first.'); return; }
  if (!WALL_SPECS) WALL_SPECS = await (await fetch('assets/lib/specs.json')).json();
  if (!BOX_TEMPLATE) BOX_TEMPLATE = await (await fetch('assets/box_template.brp')).text();

  const minx = Math.min(...ents.map(e => e.x_mm));
  const miny = Math.min(...ents.map(e => e.y_mm));
  const byId = {}; for (const e of ents) byId[e.id] = e;

  const objs = []; let bi = 0;
  for (let i = 0; i < ents.length; i++) {
    const e = ents[i];
    const tmpl = await libBrep(e.mod.id, e.dir);
    objs.push({ name: `Wall${i}`, label: `wall_${String(i).padStart(2, '0')}_${e.id}`,
                brep: translateBrep(tmpl, e.x_mm - minx, e.y_mm - miny, 0) });
    for (const conn of (e.connections || [])) {
      for (const [dx, dy, dz, tx, ty, tz] of createBlocking(conn, byId, minx, miny)) {
        objs.push({ name: `Blk${bi}`, label: `blocking_${String(bi).padStart(2, '0')}_${conn.blocking || 'C'}`,
                    brep: boxBrep(dx, dy, dz, tx, ty, tz) });
        bi++;
      }
    }
  }

  const { default: JSZip } = await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm');
  const zip = new JSZip();
  zip.file('Document.xml', documentXml(objs));
  for (const o of objs) zip.file(`${o.name}.brp`, o.brep);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'house.FCStd'; a.click();
  URL.revokeObjectURL(url);
}
