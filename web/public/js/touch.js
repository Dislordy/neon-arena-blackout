// Touch controls for phones/tablets (landscape):
// - left half: floating joystick that appears under your thumb
// - right half: drag anywhere to look
// - FIRE button also aims while you drag on it (shoot + track in one thumb)
// - ADS, jump, reload, dash, shield, scan buttons arranged around FIRE (the ☰ menu lives in the HUD)
// - optional haptics; landscape lock via fullscreen where the browser allows it
const $ = id => document.getElementById(id);
const capture = (el, id) => { try { el.setPointerCapture(id); } catch { /* pointer already gone */ } };

export class TouchControls {
  constructor({ onLook, onReload, onDash, onAbility }) {
    this.move = { x: 0, z: 0 };
    this.fire = false; this.aim = false; this.jump = false;
    this.cb = { onLook, onReload, onDash, onAbility };
    this.stickId = null; this.lookId = null; this.fireId = null; this.last = new Map();
    this.base = $('stickBase'); this.knob = $('stickKnob');
    this.bindStick(); this.bindLook(); this.bindButtons();
  }

  // ---------------------------------------------------------------- joystick
  bindStick() {
    const zone = $('moveZone'), R = 52;
    let cx = 0, cy = 0;
    const show = (x, y) => { cx = x; cy = y; this.base.style.transform = `translate(${x - 60}px, ${y - 60}px)`; this.base.classList.add('on'); };
    const update = e => {
      let dx = e.clientX - cx, dy = e.clientY - cy; const l = Math.hypot(dx, dy);
      if (l > R) { // drag the base along so the stick never "runs out"
        const over = l - R; cx += dx / l * over; cy += dy / l * over;
        this.base.style.transform = `translate(${cx - 60}px, ${cy - 60}px)`;
        dx = dx / l * R; dy = dy / l * R;
      }
      this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
      // small dead-zone, then full speed near the rim
      const k = Math.min(1, Math.max(0, (Math.hypot(dx, dy) / R - 0.12) / 0.8));
      const a = Math.atan2(dy, dx);
      this.move.x = Math.cos(a) * k; this.move.z = -Math.sin(a) * k;
    };
    zone.addEventListener('pointerdown', e => {
      if (this.stickId !== null) return;
      e.preventDefault(); this.stickId = e.pointerId; capture(zone, e.pointerId);
      show(e.clientX, e.clientY); update(e);
    });
    zone.addEventListener('pointermove', e => { if (e.pointerId === this.stickId) update(e); });
    const end = e => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null; this.move.x = this.move.z = 0;
      this.knob.style.transform = 'translate(0,0)'; this.base.classList.remove('on');
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }

  // ---------------------------------------------------------------- look (and fire-drag)
  lookStart(e, el) { this.last.set(e.pointerId, { x: e.clientX, y: e.clientY }); capture(el, e.pointerId); }
  lookMove(e) {
    const p = this.last.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (dx || dy) this.cb.onLook(dx, dy);
  }
  lookEnd(e) { this.last.delete(e.pointerId); }
  bindLook() {
    const zone = $('lookZone');
    zone.addEventListener('pointerdown', e => { e.preventDefault(); this.lookStart(e, zone); });
    zone.addEventListener('pointermove', e => this.lookMove(e));
    for (const ev of ['pointerup', 'pointercancel']) zone.addEventListener(ev, e => this.lookEnd(e));
  }

  // ---------------------------------------------------------------- buttons
  bindButtons() {
    const hold = (id, on, off) => {
      const el = $(id);
      el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('down'); on(e, el); });
      for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, e => { el.classList.remove('down'); if (off) off(e, el); });
      el.addEventListener('contextmenu', e => e.preventDefault());
    };
    const tap = (id, fn) => hold(id, () => { fn(); this.buzz(6); });
    // FIRE: hold to shoot; dragging on it also aims
    hold('mFire', (e, el) => { this.fire = true; this.lookStart(e, el); this.buzz(10); }, e => { this.fire = false; this.lookEnd(e); });
    $('mFire').addEventListener('pointermove', e => this.lookMove(e));
    // ADS toggles (holding a second finger down is awkward on a phone)
    tap('mAim', () => { this.aim = !this.aim; $('mAim').classList.toggle('active', this.aim); });
    hold('mJump', () => { this.jump = true; setTimeout(() => { this.jump = false; }, 140); this.buzz(6); });
    tap('mReload', () => this.cb.onReload());
    tap('mDash', () => this.cb.onDash());
    tap('mShield', () => this.cb.onAbility('shield'));
    tap('mScan', () => this.cb.onAbility('scan'));
  }

  /** Reset everything (e.g. on death or leaving a match) so nothing stays "held". */
  release() {
    this.fire = false; this.jump = false; this.move.x = this.move.z = 0; this.stickId = null; this.last.clear();
    this.knob.style.transform = 'translate(0,0)'; this.base.classList.remove('on');
    document.querySelectorAll('#mobileControls .down').forEach(b => b.classList.remove('down'));
  }
  setAim(v) { this.aim = v; $('mAim').classList.toggle('active', v); }
  buzz(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { /* not supported */ } }
}

/** Ask for fullscreen + landscape (works on Android Chrome; iOS shows the rotate hint instead). */
export async function goLandscape() {
  try {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch { /* fullscreen refused */ }
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch { /* lock unsupported */ }
}
