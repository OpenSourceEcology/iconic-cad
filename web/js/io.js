// =====================================================
// IO — JSON export / save / load against the v2 document model.
// The exported JSON is the contract shared with the compiler and any future
// backend, so it carries the orthogonal attributes (level, layer) per entity.
// =====================================================
import { doc } from './state.js';
import { markModelChanged } from './app.js';
import { applyLoadedData } from './load.js';
import { serializeDoc } from './serialize.js';

function serialize(includeMeta) { return serializeDoc(doc, includeMeta); }

function download(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportJSON(filename = 'layout.json') { download(serialize(true), filename); }
export function saveLayout(filename = 'layout-save.json') { download(serialize(false), filename); }

export function loadLayout(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      applyLoadedData(data);
      markModelChanged();
      // Refresh the floor switcher (it appears for 2-story loads).
      window.dispatchEvent(new Event('iconic:project'));
      // Signal a SUCCESSFUL load (fires only here, after parse + apply). home.js
      // uses this to switch the home view → design view deterministically, with no
      // focus/change-timing race. A bad/unparseable file never reaches here, so a
      // failed load correctly does NOT navigate.
      window.dispatchEvent(new Event('iconic:loaded'));
    } catch (err) {
      alert(`Could not load layout: ${err.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}
