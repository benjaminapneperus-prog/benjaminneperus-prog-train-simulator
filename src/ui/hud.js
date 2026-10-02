// Small HTML layer for crisp pixel-font text that sits on the voxel UI.
import '@fontsource/silkscreen/400.css';
import '@fontsource/silkscreen/700.css';

export class Hud {
  constructor() {
    const root = (this.root = document.createElement('div'));
    root.id = 'hud';
    root.innerHTML = `
      <div class="lbl" id="lbl-stop">STOP</div>
      <div class="lbl" id="lbl-full">FULL</div>
      <div class="lbl rev" id="lbl-rev">REV</div>
      <div class="lbl big" id="lbl-speed">0 km/h</div>
      <div class="lbl time" id="lbl-time">09:30</div>
      <div id="banner"><span></span></div>
      <div id="title"><b>FROSTPEAK LOOP</b><small>a little voxel railway</small></div>
      <div id="hint">
        <p><b>Drag the lever DOWN</b> to get steam up.<br/>Push it <b>UP</b> to brake and stop.</p>
        <p class="sub">Drag the little sun to set the time of day · a full day takes 4 minutes<br/>
        Drag the world to look around, scroll to zoom<br/>
        Keys: W/S lever · Q/E rotate · +/- zoom · H whistle · L lamp · V cab view · P pause time · M music · N sound</p>
      </div>`;
    document.body.appendChild(root);
    this.el = {
      stop: root.querySelector('#lbl-stop'), full: root.querySelector('#lbl-full'), rev: root.querySelector('#lbl-rev'),
      speed: root.querySelector('#lbl-speed'), time: root.querySelector('#lbl-time'),
      banner: root.querySelector('#banner'), bannerText: root.querySelector('#banner span'),
      hint: root.querySelector('#hint'), title: root.querySelector('#title'),
    };
    this._bannerUntil = 0;
    this._lastBanner = '';
    setTimeout(() => this.hideHint(), 16000);
  }

  place(el, p, dx = 0, dy = 0) {
    el.style.transform = `translate(${Math.round(p.x + dx)}px, ${Math.round(p.y + dy)}px) translate(-50%, -50%)`;
  }

  layout(a) {
    this.root.style.setProperty('--u', a.u);
    this.place(this.el.stop, a.stop, -6 * a.u, 0);
    this.place(this.el.full, a.full, -6 * a.u, 0);
    this.place(this.el.rev, a.rev, -6 * a.u, 0);
    this.place(this.el.speed, a.speed);
    this.place(this.el.time, a.time);
  }

  set(speedKmh, timeStr) {
    const sp = Math.round(Math.abs(speedKmh));
    const s = speedKmh < -0.4 ? `R ${sp} km/h` : `${sp} km/h`;
    if (this.el.speed.textContent !== s) this.el.speed.textContent = s;
    if (this.el.time.textContent !== timeStr) this.el.time.textContent = timeStr;
  }

  banner(text, seconds = 4) {
    if (text === this._lastBanner && performance.now() < this._bannerUntil) return;
    this._lastBanner = text;
    this.el.bannerText.innerHTML = text;
    this.el.banner.classList.add('show');
    this._bannerUntil = performance.now() + seconds * 1000;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => this.el.banner.classList.remove('show'), seconds * 1000);
  }

  hideHint() {
    if (this.el.hint.classList.contains('gone')) return;
    this.el.hint.classList.add('gone');
    setTimeout(() => (this.el.hint.style.display = 'none'), 1100);
    this.el.title.classList.add('small');
  }
}
