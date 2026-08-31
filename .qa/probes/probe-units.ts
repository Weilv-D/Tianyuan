import { Battle } from '../../src/core/battle';
import { unitInput } from '../../tests/helpers';
const b = new Battle({
  seed: 20260831,
  units: [unitInput('gongshu', 0, { c: 1, r: 6 }), unitInput('muji', 0, { c: 6, r: 6 }), unitInput('pan', 1, { c: 3, r: 1 }, { star: 2 })],
  traits: { 0: [{ id: 'jiguan', count: 2, tier: 0 }], 1: [{ id: 'guardian', count: 6, tier: 2 }] },
  maxTicks: 10,
}, null, true);
console.log(b.units.map(u => ({ id: u.entry?.id, uid: u.uid, team: u.team, alive: u.alive, cell: u.cell })));
