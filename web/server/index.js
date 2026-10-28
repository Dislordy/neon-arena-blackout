'use strict';
/*
 * NEON ARENA: BLACKOUT — authoritative game server.
 *
 * Clients only send *inputs* (movement keys, view angles, buttons). The server runs the shared simulation
 * (shared/sim.js) at 60 Hz, owns every player's position, ammo, health and score, performs hit detection with
 * lag compensation against a position history, and streams snapshots back.
 *
 *   core.js     HTTP + Socket.IO server, room table, helpers      rooms.js    rooms, spawning, match timer
 *   lagcomp.js  position history / rewind                          combat.js   damage, kills, rifle/sniper/shotgun/melee
 *   loop.js     60 Hz tick + 30 Hz snapshots                       sockets.js  joining, inputs, abilities
 *   hooks.js    extension points                                   powers/     one file per class power
 */
const { register } = require('./hooks');
// Order matters for damage: the Knight's guard is checked before the Warden's adaptation.
register(require('./powers/knight'));
register(require('./powers/warden'));
register(require('./powers/obliteration'));
require('./sockets');
const { server, rooms, io } = require('./core');
const { startLoop } = require('./loop');
const { PORT } = require('./config');

startLoop();
function listen(port = PORT) { return server.listen(port, '0.0.0.0', () => console.log(`NEON ARENA: BLACKOUT running on port ${port}`)); }
module.exports = { server, rooms, io, listen };
