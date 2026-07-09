// =====================================================
// MAIN — entry point. Wires init order: 3D renderer must exist before the UI
// switches tabs (switchTab -> setViewport touches the renderer).
// =====================================================
import { initUI } from './ui.js';
import { init3d } from './render3d.js';
import { loadPricing, updateBOM } from './bom.js';
import { resizeCanvas } from './render2d.js';
import { initHome } from './home.js';
import { initProjectOptions } from './options.js';
import { initFoundationModal } from './foundation.js';
import { initTrades } from './trades.js';
import { loadSystemManifests } from './systems.js';

loadSystemManifests().catch(e => console.warn('Construction system manifests unavailable:', e));

try {
  init3d();
} catch (e) {
  console.warn('3D preview unavailable (no WebGL?):', e);
}
initUI();
initProjectOptions();
initFoundationModal();
initTrades();
initHome();
resizeCanvas();
loadPricing().then(updateBOM);

window.addEventListener('resize', resizeCanvas);
