import Phaser from 'phaser';
import * as THREE from 'three';
import { LOCKED_ITEMS, MODEL_DIR, RACE_BIKE, RACE_BIKE_YOUTH, RACE_RIDER, modelName } from '../core/modModels';
import { services } from '../services';
import { glbOf, download, raceModels } from '../world/modelExport';
import { modelList, modModel } from '../world/modModels';
import { U } from '../world/paddock';
import { RaceView } from '../world/RaceView';

// The models page (Boss, 31 Oct 2026), opened as the game with ?models (the toolkit's "Models" page
// and the track editor's "Models…" button). It lists the objects the race view draws and saves any
// of them as a .glb that Blender opens, and lists what is in the models folder with what each file
// does in the game or why it can't be used. core/modModels.ts has the rules; docs/MODELS.md the how-to.

interface Row {
  id: string;
  label: string;
  /** Builds the object in grid units, or null when it can't be drawn. */
  make: () => THREE.Object3D | null;
  /** The file it exports as; none for a file from the models folder. */
  file?: string;
  note?: string;
  bad?: boolean;
}

const CSS = `
.mdl{position:fixed;inset:0;display:flex;flex-direction:column;background:#1d1b22;color:#f3ead8;font:14px/1.4 system-ui,sans-serif;z-index:10}
.mdl header{padding:10px 16px;border-bottom:1px solid #3a3642;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.mdl h1{font-size:18px;margin:0}
.mdl header span{color:#b9b0a0;font-size:13px}
.mdl main{flex:1;display:flex;min-height:0}
.mdl nav{width:300px;overflow:auto;border-right:1px solid #3a3642;padding:6px 0}
.mdl nav h2{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#b9b0a0;margin:12px 16px 4px}
.mdl nav button{display:block;width:100%;text-align:left;background:none;border:0;color:inherit;padding:5px 16px;font:inherit;cursor:pointer}
.mdl nav button:hover{background:#2c2933}
.mdl nav button.on{background:#ff8a1e;color:#1d1b22}
.mdl nav small{display:block;color:#b9b0a0;font-size:12px}
.mdl nav button.on small{color:#1d1b22}
.mdl nav small.bad{color:#ff7a6a}
.mdl section{flex:1;display:flex;flex-direction:column;min-width:0}
.mdl canvas{flex:1;min-height:0;width:100%;cursor:grab}
.mdl .bar{padding:10px 16px;border-top:1px solid #3a3642;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.mdl .bar b{font-size:16px}
.mdl .bar span{color:#b9b0a0}
.mdl .bar .bad{color:#ff7a6a}
.mdl .bar button{background:#ff8a1e;color:#1d1b22;border:0;border-radius:6px;padding:7px 14px;font:600 14px system-ui,sans-serif;cursor:pointer}
@media (max-width:700px){.mdl main{flex-direction:column}.mdl nav{width:auto;max-height:40vh;border-right:0;border-bottom:1px solid #3a3642}}
`;

export class ModelsScene extends Phaser.Scene {
  private view: RaceView | null = null;
  private root: HTMLDivElement | null = null;
  private preview: THREE.WebGLRenderer | null = null;
  private frame = 0;

  constructor() {
    super('models');
  }

  create(): void {
    const { content } = services;
    const holder = this.add.container(0, 0).setVisible(false);
    // A race view to build the game's own objects with; never shown.
    const track = content.tracks.tracks[0];
    this.view = new RaceView(this, holder, track, content.trackParts, 0, 0, 64, 64);
    this.rows();
    this.events.once('shutdown', () => this.close());
  }

  private rows(): void {
    const view = this.view!;
    const scenery = services.content.trackParts.scenery;
    const race: Row[] = [
      { id: RACE_BIKE, label: 'Race bike', file: `${RACE_BIKE}.glb`, note: 'Bigger than 85cc', make: () => raceModels(false).bike },
      { id: RACE_BIKE_YOUTH, label: 'Race bike (youth)', file: `${RACE_BIKE_YOUTH}.glb`, note: '85cc and under', make: () => raceModels(true).bike },
      { id: RACE_RIDER, label: 'Race rider', file: `${RACE_RIDER}.glb`, note: 'Sits on every race bike', make: () => raceModels(false).rider },
    ];
    const builtIn: Row[] = scenery
      .filter((d) => !d.model && !LOCKED_ITEMS.has(d.id))
      .map((d) => ({ id: d.id, label: d.name, file: `${d.id}.glb`, note: d.id, make: () => view.builtInItem(d.id) }));
    const role = { replace: 'Replaces the built-in one', new: 'New item in the track editor', bike: 'Replaces the race bike', rider: 'Replaces the race rider' };
    const mine: Row[] = modelList()
      .sort((a, b) => a.file.localeCompare(b.file))
      .map((m) => ({
        id: m.id,
        label: m.file,
        note: m.problems.length ? `Not used: ${m.problems.join(' ')}` : role[m.role],
        bad: m.problems.length > 0,
        make: () => modModel(m.id),
      }));
    this.page([
      ['Race bike and rider', race],
      ['Scenery', builtIn],
      [`Your models (public/${MODEL_DIR})`, mine],
    ]);
  }

  private page(groups: [string, Row[]][]): void {
    const root = document.createElement('div');
    root.className = 'mdl';
    root.innerHTML = `<style>${CSS}</style><header><h1>Models</h1><span>Export an object, change it in Blender, then save it as File › Export › glTF 2.0 (.glb) into public/${MODEL_DIR} and reload the game. Same name: replaces it. New name: a new scenery item.</span></header><main><nav></nav><section><canvas></canvas><div class="bar"></div></section></main>`;
    document.body.appendChild(root);
    this.root = root;
    const nav = root.querySelector('nav')!;
    const bar = root.querySelector('.bar') as HTMLDivElement;
    const canvas = root.querySelector('canvas')!;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.preview = renderer;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2c2933);
    scene.add(new THREE.HemisphereLight(0xe8f0ff, 0x6a5a40, 1.2));
    const sun = new THREE.DirectionalLight(0xfff1dc, 2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 500);
    let shown: THREE.Object3D | null = null;
    let grid: THREE.GridHelper | null = null;
    let az = -0.7;
    let el = 0.35;
    let dist = 4;
    const centre = new THREE.Vector3();

    const metres = (n: number) => `${(n / U).toFixed(2)} m`;
    const show = (row: Row, btn: HTMLButtonElement) => {
      nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === btn));
      if (shown) scene.remove(shown);
      if (grid) scene.remove(grid);
      shown = row.make();
      bar.innerHTML = '';
      const title = document.createElement('b');
      title.textContent = row.label;
      bar.append(title);
      if (!shown) {
        const s = document.createElement('span');
        s.className = row.bad ? 'bad' : '';
        s.textContent = row.note ?? "This can't be drawn.";
        bar.append(s);
        return;
      }
      scene.add(shown);
      const box = new THREE.Box3().setFromObject(shown);
      const size = box.getSize(new THREE.Vector3());
      box.getCenter(centre);
      dist = Math.max(size.x, size.y, size.z, 0.5) * 2.4;
      let tris = 0;
      shown.traverse((o) => {
        const g = (o as THREE.Mesh).geometry;
        if ((o as THREE.Mesh).isMesh && g) tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
      });
      const cell = U;
      const cells = Math.max(4, Math.ceil(Math.max(size.x, size.z) / cell) + 2);
      grid = new THREE.GridHelper(cells * cell, cells, 0x6a6474, 0x45404e);
      grid.position.set(centre.x, 0, centre.z);
      scene.add(grid);
      const info = document.createElement('span');
      info.textContent = `${metres(size.x)} long × ${metres(size.z)} deep × ${metres(size.y)} tall · ${Math.round(tris).toLocaleString()} triangles · grid squares are 1 m`;
      bar.append(info);
      if (row.note && row.bad) {
        const s = document.createElement('span');
        s.className = 'bad';
        s.textContent = row.note;
        bar.append(s);
      }
      if (row.file) {
        const b = document.createElement('button');
        b.textContent = `Export ${row.file}`;
        b.onclick = async () => {
          b.disabled = true;
          try {
            download(await glbOf(row.make()!), row.file!);
          } finally {
            b.disabled = false;
          }
        };
        bar.append(b);
      }
    };

    let first: (() => void) | null = null;
    for (const [heading, rows] of groups) {
      const h = document.createElement('h2');
      h.textContent = heading;
      nav.append(h);
      if (!rows.length) {
        const s = document.createElement('small');
        s.style.padding = '0 16px';
        s.textContent = 'Nothing here yet.';
        nav.append(s);
      }
      for (const row of rows) {
        const b = document.createElement('button');
        b.textContent = row.label || modelName(row.id);
        if (row.note) {
          const s = document.createElement('small');
          s.textContent = row.note;
          if (row.bad) s.className = 'bad';
          b.append(s);
        }
        b.onclick = () => show(row, b);
        nav.append(b);
        first ??= () => show(row, b);
      }
    }
    first?.();

    // Drag to turn, wheel to zoom.
    let drag: { x: number; y: number } | null = null;
    canvas.addEventListener('pointerdown', (e) => {
      drag = { x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      az -= (e.clientX - drag.x) * 0.01;
      el = Math.max(-0.2, Math.min(1.4, el + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
    });
    canvas.addEventListener('pointerup', () => (drag = null));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      dist = Math.max(0.3, dist * (e.deltaY > 0 ? 1.1 : 0.9));
    });
    const draw = () => {
      this.frame = requestAnimationFrame(draw);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * renderer.getPixelRatio()) || canvas.height !== Math.round(h * renderer.getPixelRatio())) {
        renderer.setSize(w, h, false);
        camera.aspect = w / Math.max(1, h);
        camera.updateProjectionMatrix();
      }
      if (!drag) az += 0.003;
      camera.position.set(centre.x + Math.cos(el) * Math.cos(az) * dist, centre.y + Math.sin(el) * dist, centre.z + Math.cos(el) * Math.sin(az) * dist);
      camera.lookAt(centre);
      renderer.render(scene, camera);
    };
    draw();
  }

  private close(): void {
    cancelAnimationFrame(this.frame);
    this.preview?.dispose();
    this.root?.remove();
    this.root = null;
  }
}
