import type { KeyValueStore } from './storage';

// Settings apply immediately, save automatically and have Restore Defaults (GDD 20.1).
// Categories follow the GDD: Controls, Display, Audio, Accessibility and Gameplay.

export type ZoomControl = 'slider' | 'buttons';
export const ZOOM_CONTROLS: ZoomControl[] = ['slider', 'buttons'];

export interface Settings {
  audio: { master: number; music: number; engines: number; crowd: number; muted: boolean };
  /** zoomControl: the on-screen zoom control, a pop-out slider or + and − buttons. */
  display: { zoom: number; fullscreen: boolean; zoomControl: ZoomControl };
  accessibility: { textScale: number; reducedEffects: boolean; highContrast: boolean };
  /** testRideAlone: TEST ONLY, REMOVE BEFORE RELEASE (Boss, 30 Oct 2026): practice and race days with no AI riders. */
  gameplay: { tutorialPrompts: boolean; contextHints: boolean; reminders: boolean; testRideAlone: boolean };
  controls: { up: string; down: string; left: string; right: string; interact: string; menu: string };
}

export const DEFAULT_SETTINGS: Settings = {
  audio: { master: 80, music: 70, engines: 80, crowd: 70, muted: false },
  display: { zoom: 100, fullscreen: false, zoomControl: 'slider' },
  accessibility: { textScale: 130, reducedEffects: false, highContrast: false },
  gameplay: { tutorialPrompts: true, contextHints: true, reminders: true, testRideAlone: false },
  controls: { up: 'W', down: 'S', left: 'A', right: 'D', interact: 'E', menu: 'ESC' },
};

/** Zoom range from the style guide: 50% to 200%. */
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
/** Text size range (%). The default sits in the middle so players can go either way. */
export const TEXT_MIN = 80;
export const TEXT_MAX = 180;
/** One click of the zoom buttons, mouse wheel or +/- keys. */
export const ZOOM_STEP = 10;

const KEY = 'settings';

type Listener = (s: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private readonly listeners = new Set<Listener>();

  constructor(private readonly store: KeyValueStore) {
    this.value = load(store);
  }

  get(): Settings {
    return this.value;
  }

  /** Changes one setting, saves and notifies at once. */
  update<C extends keyof Settings, K extends keyof Settings[C]>(category: C, field: K, v: Settings[C][K]): void {
    this.value = { ...this.value, [category]: { ...this.value[category], [field]: v } };
    this.save();
  }

  restoreDefaults(): void {
    this.value = structuredClone(DEFAULT_SETTINGS);
    this.save();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(): void {
    try {
      this.store.set(KEY, JSON.stringify(this.value));
    } catch {
      // Storage full or blocked: the setting still applies for this session.
    }
    for (const fn of this.listeners) fn(this.value);
  }
}

/** Loads saved settings over the defaults, so a new setting added in a later build gets its default. */
function load(store: KeyValueStore): Settings {
  const out = structuredClone(DEFAULT_SETTINGS);
  let saved: Record<string, Record<string, unknown>> = {};
  try {
    saved = JSON.parse(store.get(KEY) ?? '{}');
  } catch {
    return out;
  }
  for (const cat of Object.keys(out) as (keyof Settings)[]) {
    const target = out[cat] as Record<string, unknown>;
    for (const field of Object.keys(target)) {
      const v = saved?.[cat]?.[field];
      if (typeof v === typeof target[field]) target[field] = v;
    }
  }
  if (!ZOOM_CONTROLS.includes(out.display.zoomControl)) out.display.zoomControl = DEFAULT_SETTINGS.display.zoomControl;
  out.display.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, out.display.zoom));
  out.accessibility.textScale = Math.min(TEXT_MAX, Math.max(TEXT_MIN, out.accessibility.textScale));
  return out;
}
