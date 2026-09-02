import { PRESET_COMPS } from '../../src/game/comp';
process.send!({ ok: true, comps: PRESET_COMPS.length });
