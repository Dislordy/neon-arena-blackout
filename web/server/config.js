'use strict';
// Server-only tuning. Gameplay numbers shared with the browser live in shared/sim.js.
module.exports = {
  PORT: process.env.PORT || 3000,
  MATCH_MS: Number(process.env.MATCH_MS) || 4 * 60 * 1000,
  RESPAWN_MS: 2500,
  SPAWN_PROTECT_MS: 1600,
  MAX_PLAYERS: 8,
  MAX_QUEUE: 40,               // max buffered input commands per player
  MAX_BUDGET: 0.3,             // seconds of simulation a client can "bank" (jitter tolerance)
  MAX_INPUTS_PER_TICK: 8,
  HISTORY_MS: 1000,            // position history kept for lag compensation
  ABILITIES: {
    shield: { duration: 2200, cooldown: 9000 },
    scan: { duration: 1400, cooldown: 12000 }
  },
  COLORS: ['#00f5ff', '#ff36c7', '#b6ff4a', '#ffb347', '#9b7bff', '#ff5f6d', '#56e39f', '#f4f7ff'],
  CODE_CHARS: 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
  DEBUG: process.env.NAB_DEBUG === '1' // test-only socket hooks; never set on the public server
};
