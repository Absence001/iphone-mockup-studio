import { DEFAULT_SETTINGS, type ScreenKind, type Settings } from "./settings";

export interface ScreenImage {
  url: string; name: string; width: number; height: number; demo: boolean;
  /** Видео живёт в том же слоте, что и картинка: экран у устройства один. */
  kind: ScreenKind;
  /** Длительность видео в секундах; у изображения 0. */
  duration: number;
}
export interface DocumentState {
  settings: Settings;
  /** Что на экране устройства. */
  image: ScreenImage;
  /** Своё фото или видео позади устройства; demo означает «не загружено». */
  backdrop: ScreenImage;
}
export interface HistoryState { past: DocumentState[]; present: DocumentState; future: DocumentState[]; group: string | undefined; changedAt: number }
export type HistoryAction =
  | { type: "change"; recipe: (current: DocumentState) => DocumentState; group?: string; time: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "end-group" };

export const INITIAL_DOCUMENT: DocumentState = {
  settings: DEFAULT_SETTINGS,
  // Пустой экран по умолчанию: никакой подставной картинки, которую можно
  // принять за свою.
  image: { url: "", name: "", width: 0, height: 0, demo: true, kind: "image", duration: 0 },
  backdrop: { url: "", name: "", width: 0, height: 0, demo: true, kind: "image", duration: 0 },
};

/** Пустой слот: им же сбрасываются экран и фон. */
export const EMPTY_ASSET: ScreenImage = { url: "", name: "", width: 0, height: 0, demo: true, kind: "image", duration: 0 };

export const INITIAL_HISTORY: HistoryState = { past: [], present: INITIAL_DOCUMENT, future: [], group: undefined, changedAt: 0 };

export function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  if (action.type === "end-group") return { ...state, group: undefined };
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future], group: undefined, changedAt: 0 } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1), group: undefined, changedAt: 0 } : state;
  }
  const next = action.recipe(state.present);
  if (JSON.stringify(next) === JSON.stringify(state.present)) return state;
  const grouped = Boolean(action.group && action.group === state.group && action.time - state.changedAt < 600);
  return {
    past: grouped ? state.past : [...state.past, state.present].slice(-80),
    present: next, future: [], group: action.group, changedAt: action.time,
  };
}
