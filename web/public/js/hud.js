// DOM heads-up display: vitals, ammo pips, reload bar, ability cooldowns, dynamic
// crosshair, hit markers, damage numbers, damage direction arcs, kill banners, scoreboard.
const Sim = window.NeonSim;
const $ = id => document.getElementById(id);
export const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Hud {
  constructor() {
    this.pips = [];
    const pc = $('ammoPips');
    for (let i = 0; i < Sim.MAG_SIZE; i++) { const p = document.createElement('i'); pc.appendChild(p); this.pips.push(p); }
    this.last = {};
    this.dmgNums = [];
    this.gap = 6;
  }
  set(key, val, fn) { if (this.last[key] !== val) { this.last[key] = val; fn(val); } }

  /** hp / max health, sh / max shield (the shield soaks damage first and recharges). */
  vitals(hp, maxHp = 100, sh = 0, maxSh = 50, regen = false) {
    this.set('hp', hp + '/' + maxHp, () => {
      const f = Math.max(0, Math.min(100, hp / maxHp * 100));
      $('hp').textContent = Math.max(0, Math.round(hp));
      $('healthFill').style.width = f + '%';
      $('healthGhost').style.width = f + '%';
      $('healthFill').classList.toggle('low', hp / maxHp <= 0.35);
    });
    this.set('sh', Math.round(sh) + '/' + maxSh, () => {
      $('sh').textContent = Math.round(sh);
      $('shieldFill').style.width = (maxSh ? Math.max(0, sh / maxSh * 100) : 0) + '%';
    });
    this.set('shregen', regen, v => $('shieldFill').classList.toggle('regen', v));
  }
  className(name) { this.set('cls', name, v => { $('className').textContent = v; }); }
  /** weapon: 'rifle' | 'sword' | 'shotgun' */
  ammo(ammo, reloadTicks, weapon = 'rifle') {
    this.set('weapon', weapon, w => {
      const mag = Sim.magOf(w);
      this.pips.forEach((p, i) => { p.style.display = i < mag ? '' : 'none'; });
      $('ammo').nextElementSibling.textContent = mag ? ` / ${mag}` : '';
      $('weaponName').textContent = w === 'claws' ? 'RUNE-WARDEN · CLAWS & BONE BLADE' : w === 'sword' ? 'CINDER OATH GREATSWORD' : w === 'shotgun' ? 'PYRE SHOTGUN · ' + Sim.SHOTGUN_SHELLS + ' SHELLS' : w === 'sniper' ? 'LONGWIRE SNIPER RIFLE' : 'VX-9 ENERGY RIFLE';
      $('ammo').parentElement.classList.toggle('melee', w === 'sword' || w === 'claws');
      $('crosshair').dataset.mode = w;
      this.last.ammo = undefined;
    });
    this.set('ammo', weapon === 'sword' ? '⚔' : weapon === 'claws' ? '☬' : ammo, v => {
      $('ammo').textContent = v;
      if (weapon !== 'sword' && weapon !== 'claws') this.pips.forEach((p, i) => p.classList.toggle('spent', i >= v));
      $('ammo').parentElement.classList.toggle('low', weapon === 'rifle' ? v <= 6 : (weapon === 'shotgun' || weapon === 'sniper') && v <= 1);
    });
    const r = reloadTicks > 0 && weapon === 'rifle' ? 1 - reloadTicks / Sim.RELOAD_TICKS : reloadTicks > 0 && weapon === 'sniper' ? 1 - reloadTicks / Sim.SNIPER_RELOAD_TICKS : 0;
    this.set('reload', Math.round(r * 100), v => { $('reloadFill').style.width = v + '%'; });
  }
  /** Assassin kill-streak meter (5 in a row = Obliteration Beam). */
  ult(show, streak, ready, charging) {
    this.set('ult', `${show}|${streak}|${ready}|${charging}`, () => {
      $('ultBox').classList.remove('runes', 'cinder'); [...$('ultPips').children].forEach(p => { p.style.display = ''; });
      $('ultBox').classList.toggle('hidden', !show);
      $('ultBox').classList.toggle('ready', ready || charging);
      $('ultLabel').textContent = charging ? 'CHARGING…' : ready ? 'OBLITERATION READY · FIRE' : 'STREAK';
      [...$('ultPips').children].forEach((p, i) => p.classList.toggle('on', ready || charging || i < streak));
    });
  }
  /** Soldier rune meter (3 in a row = Rune-Warden), the awakening, and the monster's remaining time. */
  runes(show, n, rising, secs) {
    this.set('ult', `r|${show}|${n}|${rising}|${secs}`, () => {
      $('ultBox').classList.toggle('hidden', !show);
      $('ultBox').classList.toggle('ready', rising || secs > 0);
      $('ultBox').classList.remove('cinder'); $('ultBox').classList.add('runes');
      $('ultLabel').textContent = rising ? 'THE RUNES AWAKEN…' : secs > 0 ? `RUNE-WARDEN · ${secs}s` : 'RUNES';
      [...$('ultPips').children].forEach((p, i) => { p.style.display = i < Sim.MON_STREAK ? '' : 'none'; p.classList.toggle('on', rising || secs > 0 || i < n); });
    });
  }
  /** Knight ember meter (4 in a row = Cinder Crash), ready, and mid-leap. */
  cinder(show, n, ready, leaping) {
    this.set('ult', `c|${show}|${n}|${ready}|${leaping}`, () => {
      $('ultBox').classList.remove('runes'); $('ultBox').classList.add('cinder');
      $('ultBox').classList.toggle('hidden', !show);
      $('ultBox').classList.toggle('ready', ready || leaping);
      $('ultLabel').textContent = leaping ? 'CINDER CRASH!' : ready ? 'CINDER CRASH READY · ATTACK' : 'EMBERS';
      [...$('ultPips').children].forEach((p, i) => { p.style.display = i < Sim.CRASH_STREAK ? '' : 'none'; p.classList.toggle('on', ready || leaping || i < n); });
    });
  }
  scope(on) { this.set('scope', on, v => { $('scope').classList.toggle('hidden', !v); $('crosshair').style.visibility = v ? 'hidden' : ''; }); }
  /** Dash-charge badge (top-right of the dash buttons): charges left and the next charge's refill progress. */
  dashCharges(n, max, refillFrac) {
    this.set('dashc', n + '/' + max + '/' + Math.round(refillFrac * 20), () => {
      for (const el of document.querySelectorAll('[data-charges]')) {
        el.classList.toggle('on', max > 1);
        el.classList.toggle('empty', n === 0);
        el.textContent = n;
        el.style.setProperty('--rc', n < max ? (1 - refillFrac).toFixed(2) : 0);
      }
    });
  }
  status(text) { this.set('status', text, v => { $('weaponStatus').textContent = v; }); }
  score(score) { this.set('score', score, v => { $('score').textContent = String(v).padStart(3, '0'); }); }
  timer(t) { this.set('timer', t, v => { $('timer').textContent = `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; }); }
  net(text) { this.set('net', text, v => { $('netStats').textContent = v; }); }
  ability(id, cdFrac, active) {
    const m = $({ dashBtn: 'mDash', shieldBtn: 'mShield', scanBtn: 'mScan' }[id]); // matching touch button
    this.set(id + 'cd', Math.round(cdFrac * 50), v => {
      for (const el of [$(id), m]) if (el) { el.style.setProperty('--cd', (v / 50).toFixed(2)); el.classList.toggle('ready', v === 0); }
    });
    this.set(id + 'on', active, v => { for (const el of [$(id), m]) if (el) el.classList.toggle('active', v); });
  }
  crosshair(spread, ads) {
    this.gap += (6 + spread - this.gap) * 0.35;
    const g = Math.round(this.gap * 2) / 2;
    this.set('gap', g, v => $('crosshair').style.setProperty('--gap', v + 'px'));
    this.set('ads', ads, v => $('crosshair').classList.toggle('ads', v));
  }
  hitmarker(kind) {
    const el = $('hitmarker');
    el.className = 'hitmarker';
    void el.offsetWidth;
    el.className = 'hitmarker show ' + kind;
  }
  damageNumber(text, cls, worldPos) {
    const el = document.createElement('div');
    el.className = 'dmgnum ' + (cls || '');
    el.textContent = text;
    $('dmgNums').appendChild(el);
    this.dmgNums.push({ el, pos: worldPos.clone(), t: 0, dx: (Math.random() - 0.5) * 40 });
  }
  updateDamageNumbers(dt, camera) {
    const w = innerWidth, h = innerHeight;
    for (let i = this.dmgNums.length - 1; i >= 0; i--) {
      const d = this.dmgNums[i];
      d.t += dt;
      if (d.t > 0.9) { d.el.remove(); this.dmgNums.splice(i, 1); continue; }
      const p = d.pos.clone().project(camera);
      if (p.z > 1) { d.el.style.opacity = 0; continue; }
      const x = (p.x * 0.5 + 0.5) * w + d.dx * d.t, y = (-p.y * 0.5 + 0.5) * h - d.t * 60;
      const s = d.t < 0.12 ? 1 + (0.12 - d.t) * 5 : 1;
      d.el.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%) scale(${s.toFixed(2)})`;
      d.el.style.left = '0'; d.el.style.top = '0';
      d.el.style.opacity = Math.min(1, (0.9 - d.t) * 3).toFixed(2);
    }
  }
  damageDirection(angle) {
    const el = document.createElement('div');
    el.className = 'dmgdir';
    el.style.transform = `rotate(${angle}rad)`;
    $('dmgDirs').appendChild(el);
    setTimeout(() => el.remove(), 1150);
  }
  killBanner(html) {
    const el = $('killBanner');
    el.innerHTML = html;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }
  notice(text, ms = 1100) {
    const el = $('notice'); el.textContent = text; el.classList.add('show');
    clearTimeout(this.noticeT); this.noticeT = setTimeout(() => el.classList.remove('show'), ms);
  }
  leaderboard(players, myId) {
    const html = [...players].sort((a, b) => b.score - a.score || b.kills - a.kills)
      .map(p => `<div class="rankrow ${p.id === myId ? 'me' : ''}"><span><i style="background:${p.color}"></i>${escapeHtml(p.name)}</span><b>${p.score}</b></div>`).join('');
    this.set('lb', html, v => { $('leaderRows').innerHTML = v; });
    const sb = '<div class="scorerow head"><span>#</span><span>RUNNER</span><span>K</span><span>D</span><span>SCORE</span></div>' +
      [...players].sort((a, b) => b.score - a.score || b.kills - a.kills).map((p, i) =>
        `<div class="scorerow ${p.id === myId ? 'me' : ''}"><span>${i + 1}</span><span><i style="display:inline-block;width:8px;height:8px;margin-right:6px;background:${p.color}"></i>${escapeHtml(p.name)}</span><span>${p.kills}</span><span>${p.deaths}</span><span>${p.score}</span></div>`).join('');
    this.set('sb', sb, v => { $('scoreRows').innerHTML = v; });
  }
  feed(items) {
    const html = items.slice(-4).map(f => `<div class="feeditem ${f.kind === 'kill' ? '' : 'info'}">${escapeHtml(f.message)}</div>`).join('');
    this.set('feed', html, v => { $('feed').innerHTML = v; });
  }
  death(show, by, respawnIn) {
    this.set('dead', show, v => { $('deathScreen').classList.toggle('hidden', !v); $('gameHud').classList.toggle('dead', v); });
    if (show) {
      this.set('by', by, v => { $('killedBy').innerHTML = v ? `by <b style="color:var(--pink)">${escapeHtml(v)}</b>` : ''; });
      this.set('rin', respawnIn, v => { $('respawnIn').textContent = v > 0 ? `REDEPLOYING IN ${v.toFixed(1)}s` : 'REDEPLOYING…'; });
    }
  }
}
