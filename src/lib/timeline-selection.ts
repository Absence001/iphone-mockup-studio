import { findKey, objectTracks, trackInfo, type AnimatedObject, type Animation, type EaseId, type KeyRef, type TrackId } from "./animation";

/** Участок задаётся ключами, поэтому выбор переживает перенос и отмену. */
export interface SegmentRef { track: TrackId; from: string; to: string }
export type Selection =
  | { kind: "keys"; keys: KeyRef[] }
  | { kind: "segments"; segments: SegmentRef[] }
  | { kind: "track"; track: TrackId }
  | { kind: "audio" }
  | null;

export const sameKey = (a: KeyRef, b: KeyRef) => a.track === b.track && a.id === b.id;
export const sameSegment = (a: SegmentRef, b: SegmentRef) => a.track === b.track && a.from === b.from && a.to === b.to;
export const uniqueKeys = (keys: KeyRef[]) => keys.filter((key, index) => keys.findIndex((other) => sameKey(key, other)) === index);
export const objectKeys = (animation: Animation, object: AnimatedObject): KeyRef[] => objectTracks(object).flatMap((track) => (animation.tracks[track] ?? []).map(({ id }) => ({ track, id })));

export function validSegment(animation: Animation, segment: SegmentRef) {
  const keys = animation.tracks[segment.track] ?? [];
  const index = keys.findIndex((key) => key.id === segment.from);
  return index >= 0 && keys[index + 1]?.id === segment.to;
}

/** Только интервалы с обоими выбранными концами: соседние не меняются. */
export function selectedSegments(animation: Animation, selection: Selection): SegmentRef[] {
  if (selection?.kind === "segments") return selection.segments.filter((segment) => validSegment(animation, segment));
  if (selection?.kind !== "keys") return [];
  const refs = selection.keys;
  return [...new Set(refs.map((key) => key.track))].flatMap((track) => {
    const keys = animation.tracks[track] ?? [];
    return keys.slice(0, -1).flatMap((key, index) => refs.some((ref) => ref.track === track && ref.id === key.id) && refs.some((ref) => ref.track === track && ref.id === keys[index + 1].id)
      ? [{ track, from: key.id, to: keys[index + 1].id }] : []);
  });
}

export function selectedKeys(animation: Animation, selection: Selection): KeyRef[] {
  if (selection?.kind === "keys") return selection.keys.filter((ref) => findKey(animation, ref));
  return uniqueKeys(selectedSegments(animation, selection).flatMap(({ track, from, to }) => [{ track, id: from }, { track, id: to }]));
}

export function selectionEase(animation: Animation, segments: SegmentRef[]): EaseId | "mixed" | null {
  const values = new Set(segments.filter((segment) => validSegment(animation, segment)).map((segment) => findKey(animation, { track: segment.track, id: segment.from })!.ease));
  return values.size === 1 ? [...values][0] : values.size > 1 ? "mixed" : null;
}

export function setSelectionEase(animation: Animation, segments: SegmentRef[], ease: EaseId): Animation {
  const tracks = { ...animation.tracks };
  for (const segment of segments) {
    if (!validSegment(animation, segment)) continue;
    tracks[segment.track] = tracks[segment.track]?.map((key) => key.id === segment.from ? { ...key, ease } : key);
  }
  return { ...animation, tracks };
}

export function selectionLabel(refs: KeyRef[]) {
  const tracks = [...new Set(refs.map((ref) => ref.track))];
  if (tracks.length === 1) return trackInfo(tracks[0]).label.toLowerCase();
  const objects = new Set(tracks.map((track) => trackInfo(track).object));
  return objects.size === 1 ? objects.has("camera") ? "камера" : "устройство" : "камера и устройство";
}
