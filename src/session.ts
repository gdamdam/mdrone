import { STORAGE_KEYS } from "./config";
import type { EffectId } from "./engine/FxChain";
import type { VoiceType } from "./engine/VoiceBuilder";
import type { PitchClass, ScaleId } from "./types";

export interface DroneSessionSnapshot {
  activePresetId: string | null;
  playing: boolean;
  root: PitchClass;
  octave: number;
  scale: ScaleId;
  voiceLayers: Record<VoiceType, boolean>;
  voiceLevels: Record<VoiceType, number>;
  effects: Record<EffectId, boolean>;
  drift: number;
  air: number;
  time: number;
  sub: number;
  bloom: number;
  glide: number;
  climateX: number;
  climateY: number;
  lfoShape: OscillatorType;
  lfoRate: number;
  lfoAmount: number;
}

export interface MixerSessionSnapshot {
  hpfHz: number;
  low: number;
  mid: number;
  high: number;
  glue: number;
  drive: number;
  limiterOn: boolean;
  ceiling: number;
  volume: number;
}

export interface SavedSession {
  id: string;
  name: string;
  savedAt: string;
  version: 1;
  drone: DroneSessionSnapshot;
  mixer: MixerSessionSnapshot;
}

function hasLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadSessions(): SavedSession[] {
  if (!hasLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sessions);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as SavedSession[] : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: SavedSession[]): void {
  if (!hasLocalStorage()) return;
  localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(sessions));
}

export function loadCurrentSessionId(): string | null {
  if (!hasLocalStorage()) return null;
  return localStorage.getItem(STORAGE_KEYS.currentSessionId);
}

export function saveCurrentSessionId(id: string | null): void {
  if (!hasLocalStorage()) return;
  if (id) localStorage.setItem(STORAGE_KEYS.currentSessionId, id);
  else localStorage.removeItem(STORAGE_KEYS.currentSessionId);
}

export function makeSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
