/// <reference types="vitest/config" />
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from 'vite';
import { modelEntry } from './src/core/modModels';

// Mod tracks (src/core/modTracks.ts): a website can't list a folder, so the game reads an index
// of public/mods/tracks/, made here from whatever track files are in it.
const MOD_DIR = 'public/mods/tracks';
const modIndex = () => JSON.stringify(existsSync(MOD_DIR) ? readdirSync(MOD_DIR).filter((f) => /\.json$/i.test(f) && f !== 'index.json').sort() : []);

// Mod models (src/core/modModels.ts): the same for public/mods/models/, with each model's size,
// weight and problems read here, so the game and the track editor see the same list.
const MODEL_DIR = 'public/mods/models';
function modelIndex(): string {
  if (!existsSync(MODEL_DIR)) return '[]';
  let scenery: { id: string }[] = [];
  try {
    scenery = (JSON.parse(readFileSync('public/data/trackParts.json', 'utf8')) as { scenery: { id: string }[] }).scenery;
  } catch {
    /* no parts: every model is a new item */
  }
  const files = readdirSync(MODEL_DIR).filter((f) => /\.glb$/i.test(f)).sort();
  return JSON.stringify(files.map((f) => modelEntry(f, new Uint8Array(readFileSync(`${MODEL_DIR}/${f}`)), scenery)));
}

// The map editor saves into the game while developing: these files under public/, and nothing else.
const TOOLKIT_SAVES = [/^assets\/maps\/[A-Za-z0-9_-]+\.json$/, /^assets\/manifest\.json$/, /^assets\/custom\/[a-z0-9_-]+(\/[a-z0-9_-]+)*\.png$/, /^data\/(buildings|world)\.json$/];
/** The pictures the map editor made (public/assets/custom), as paths under public/assets. */
function customPictures(dir = 'public/assets/custom', rel = 'custom'): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? customPictures(`${dir}/${e.name}`, `${rel}/${e.name}`) : e.name.endsWith('.png') ? [`${rel}/${e.name}`] : []));
}

// The toolkit's pages, published at tools/: the front page, its stylesheet and each editor.
const TOOLKIT_PAGES = ['index.html', 'toolkit.css', 'track-editor.html', 'map-editor.html', 'outfit-designer.html', 'character-designer.html'];

export default defineConfig({
  // Relative paths so the build runs from any folder (desktop wrapper, file share, static host).
  base: './',
  plugins: [
    {
      // Read fresh on every request while developing, so a dropped-in track shows on the next load.
      name: 'mod-track-index',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] ?? '';
          if (url.endsWith('/mods/tracks/index.json')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(modIndex());
          }
          if (url.endsWith('/mods/models/index.json')) {
            res.setHeader('Content-Type', 'application/json');
            return res.end(modelIndex());
          }
          next();
        });
        // The track editor saves player-made tracks here while developing: POST /__mods/tracks/<name>.track.json.
        server.middlewares.use('/__mods/tracks/', (req, res) => {
          const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\//, ''));
          const fail = (code: number, message: string) => {
            res.statusCode = code;
            res.end(message);
          };
          if (req.method !== 'POST') return fail(405, 'POST a track file');
          if (!/^[a-z0-9][a-z0-9_-]{0,60}\.track\.json$/.test(name)) return fail(400, 'The file name must be letters, digits, - and _, ending .track.json');
          let body = '';
          req.setEncoding('utf8');
          req.on('data', (c: string) => {
            body += c;
            if (body.length > 4_000_000) req.destroy();
          });
          req.on('end', () => {
            try {
              JSON.parse(body);
            } catch {
              return fail(400, 'Not JSON');
            }
            mkdirSync(MOD_DIR, { recursive: true });
            writeFileSync(`${MOD_DIR}/${name}`, body);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ saved: `${MOD_DIR}/${name}` }));
          });
        });
        // The map editor (tools/map-editor.html) while developing: GET /__toolkit/files lists the map
        // files in public/assets/maps and the pictures it made, for its file check; POST /__toolkit/save/<path under public> writes a map, the manifest, the
        // building library or one of its pictures straight into the game.
        server.middlewares.use('/__toolkit/', (req, res) => {
          const url = (req.url ?? '').split('?')[0];
          const fail = (code: number, message: string) => {
            res.statusCode = code;
            res.end(message);
          };
          if (url === '/files') {
            const maps = existsSync('public/assets/maps') ? readdirSync('public/assets/maps').filter((f) => f.endsWith('.json')).sort().map((f) => `maps/${f}`) : [];
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ maps, pictures: customPictures() }));
          }
          if (!url.startsWith('/save/')) return fail(404, 'Unknown toolkit request');
          const file = decodeURIComponent(url.slice('/save/'.length));
          if (req.method !== 'POST') return fail(405, 'POST the file');
          if (file.includes('..') || !TOOLKIT_SAVES.some((r) => r.test(file))) return fail(400, `The toolkit can't save ${file}`);
          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (c: Buffer) => {
            size += c.length;
            if (size > 20_000_000) req.destroy();
            else chunks.push(c);
          });
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (file.endsWith('.json')) {
              try {
                JSON.parse(body.toString('utf8'));
              } catch {
                return fail(400, 'Not JSON');
              }
            } else if (body.subarray(1, 4).toString('latin1') !== 'PNG') return fail(400, 'Not a PNG');
            mkdirSync(dirname(`public/${file}`), { recursive: true });
            writeFileSync(`public/${file}`, body);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ saved: `public/${file}` }));
          });
        });
      },
      closeBundle() {
        if (!existsSync('dist')) return;
        mkdirSync('dist/mods/tracks', { recursive: true });
        writeFileSync('dist/mods/tracks/index.json', `${modIndex()}\n`);
        mkdirSync('dist/mods/models', { recursive: true });
        writeFileSync('dist/mods/models/index.json', `${modelIndex()}\n`);
      },
    },
    {
      // The toolkit (tools/index.html) and its editors are plain HTML files: published beside the
      // game as they are, at tools/, so they can be used from the published site, where the track
      // editor's race view runs the game one folder up. The game's menus don't link to them.
      name: 'copy-toolkit',
      apply: 'build',
      closeBundle() {
        mkdirSync('dist/tools', { recursive: true });
        for (const page of TOOLKIT_PAGES) copyFileSync(`tools/${page}`, `dist/tools/${page}`);
      },
    },
  ],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
