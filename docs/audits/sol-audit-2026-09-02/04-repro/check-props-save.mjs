/**
 * Static contract check: state/load support props and assembly compose consumes
 * them, but io serialization has no props field. This avoids importing io.js,
 * whose browser-only import chain requires Three.js and a DOM under Node.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../../../code/iconic-cad/web/js/', import.meta.url));
const state = readFileSync(`${root}/state.js`, 'utf8');
const load = readFileSync(`${root}/load.js`, 'utf8');
const io = readFileSync(`${root}/io.js`, 'utf8');
const assembly = readFileSync(`${root}/assembly_translate.js`, 'utf8');

const facts = {
  state_declares_props: /connections:\[\], props:\{\}/.test(state),
  loader_restores_props: /props:\s*m\.props\s*\|\|\s*\{\}/.test(load),
  compose_consumes_props: /entity\.props\s*&&\s*entity\.props\.assembly/.test(assembly),
  serializer_writes_props: /\.\.\.\(p\.props|props:\s*p\.props/.test(io),
};

console.log(facts);
if (!facts.state_declares_props || !facts.loader_restores_props ||
    !facts.compose_consumes_props || facts.serializer_writes_props) {
  throw new Error('source contract changed; re-audit the props round trip');
}
