'use strict';
/*
 * Extension points for the class powers (server/powers/*.js). Each power registers what it needs, so the
 * core (combat, loop, sockets) stays free of class-specific rules.
 *
 *   damage(room, shooter, target, dmg, ctx)  -> new dmg, or null to cancel the hit   (ctx: { weapon, part, point, t })
 *   swingDamage(room, shooter, dmg, claws, t)-> new dmg (melee only)
 *   kill(room, shooter, target, weapon)        streak rewards; runs before the kill is announced
 *   afterKill(room, shooter, target, weapon)   runs after the kill is announced
 *   death(room, target)                        reset what dying takes away
 *   event(room, p, ev, input)                  per-input simulation events (ev from Sim.stepPlayer)
 *   roomTick(room, t)                          once per server tick while playing
 *   matchStart(room)                           new match: clear leftover state
 *   socket(socket, ctx)                        extra socket handlers (ctx: { getRoom, getMe })
 *   debug(room, p, d)                          NAB_DEBUG test hooks
 */
const hooks = { damage: [], swingDamage: [], kill: [], afterKill: [], death: [], event: [], roomTick: [], matchStart: [], socket: [], debug: [] };
function register(power) {
  for (const k of Object.keys(power)) if (hooks[k]) hooks[k].push(power[k]);
}
module.exports = { hooks, register };
