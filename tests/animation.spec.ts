import { test, expect } from "@playwright/test";
import { EMPTY_ANIMATION, ease, evaluate, moveKeys, parseAnimation, sampleTrack, serializeAnimation, setEase, setKey, setSegmentLength, withDuration, type Animation } from "../src/lib/animation";
import { CAMERA_MOVES, applyCameraMove, focusOffset, type SceneLayout } from "../src/lib/camera-moves";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { parseProject } from "../src/lib/project";
import { objectKeys, selectedSegments, setSelectionEase } from "../src/lib/timeline-selection";

const keys = (animation: Animation, track: keyof Animation["tracks"]) => (animation.tracks[track] ?? []).map((key) => [key.time, key.value, key.ease]);

test("групповое выделение: easing выбранных участков и интервалы у краёв", () => {
  let animation = { ...EMPTY_ANIMATION, duration: 8 };
  for (const time of [1, 2, 3, 4]) animation = setKey(animation, "camera.azimuth", time, time * 10);
  animation = setKey(setKey(animation, "transform.x", 2, 0), "transform.x", 4, 1);
  const refs = objectKeys(animation, "camera");
  const selected = selectedSegments(animation, { kind: "keys", keys: [refs[0], refs[1], refs[3]] });
  expect(selected).toHaveLength(1);
  const changed = setSelectionEase(animation, selected, "outBack");
  expect(changed.tracks["camera.azimuth"]!.map((key) => key.ease)).toEqual(["outBack", "inOutCubic", "inOutCubic", "inOutCubic"]);
  expect(changed.tracks["transform.x"]).toEqual(animation.tracks["transform.x"]);
  const all = [...refs, ...objectKeys(animation, "device")];
  expect(selectedSegments(animation, { kind: "keys", keys: all })).toHaveLength(4);
  const right = moveKeys(animation, all, 100);
  expect(right.tracks["camera.azimuth"]!.map((key) => key.time)).toEqual([5, 6, 7, 8]);
  expect(right.tracks["transform.x"]!.map((key) => key.time)).toEqual([6, 8]);
  const left = moveKeys(animation, all, -100);
  expect(left.tracks["camera.azimuth"]!.map((key) => key.time)).toEqual([0, 1, 2, 3]);
  expect(left.tracks["transform.x"]!.map((key) => key.time)).toEqual([1, 3]);
});

test("кривые: концы на месте, перелёт и симметрия плавной кривой", () => {
  for (const id of ["linear", "inQuad", "outCubic", "inOutSine", "inExpo", "outCirc", "inOutBack"] as const) {
    expect(ease(id, 0)).toBeCloseTo(0, 6);
    expect(ease(id, 1)).toBeCloseTo(1, 6);
  }
  expect(ease("inOutCubic", 0.5)).toBeCloseTo(0.5, 6);
  expect(ease("inOutCubic", 0.25) + ease("inOutCubic", 0.75)).toBeCloseTo(1, 6);
  // «С перелётом» уходит за конечное значение и возвращается.
  expect(Math.max(...Array.from({ length: 50 }, (_, index) => ease("outBack", index / 49)))).toBeGreaterThan(1.05);
  expect(ease("inCubic", 0.5)).toBeLessThan(0.5);
  expect(ease("outCubic", 0.5)).toBeGreaterThan(0.5);
});

test("ключи: значение между ключами, полный оборот и края ролика", () => {
  let animation = setKey(EMPTY_ANIMATION, "transform.rotY", 0, 0);
  animation = setKey(animation, "transform.rotY", 2, 360);
  animation = setEase(animation, ["transform.rotY"], 0, 2, "linear");
  // 0° → 360° — полный оборот, а не стояние на месте.
  expect(sampleTrack(animation.tracks["transform.rotY"], 1)).toBeCloseTo(180, 6);
  expect(sampleTrack(animation.tracks["transform.rotY"], -1)).toBe(0);
  expect(sampleTrack(animation.tracks["transform.rotY"], 5)).toBe(360);
  // Неанимированные свойства берутся из настроек сцены.
  const frame = evaluate(DEFAULT_SETTINGS, animation, 0.5);
  expect(frame.transform.rotY).toBeCloseTo(90, 6);
  expect(frame.camera).toEqual(DEFAULT_SETTINGS.camera);
  // Ключ в том же времени обновляется, а не дублируется.
  animation = setKey(animation, "transform.rotY", 2, 270);
  expect(keys(animation, "transform.rotY").map(([time, value]) => [time, value])).toEqual([[0, 0], [2, 270]]);
  // Кривая хранится в ключе, с которого начинается участок.
  expect(animation.tracks["transform.rotY"]![0].ease).toBe("linear");
});

test("перенос ключей, длина участка и длительность не теряют ключи", () => {
  let animation = setKey(setKey(setKey(EMPTY_ANIMATION, "camera.azimuth", 0, 0), "camera.azimuth", 1, 30), "camera.azimuth", 2, 60);
  const middle = animation.tracks["camera.azimuth"]![1];
  // Ключ, перенесённый на место другого, заменяет его.
  const merged = moveKeys(animation, [{ track: "camera.azimuth", id: middle.id }], 1);
  expect(keys(merged, "camera.azimuth").map(([time, value]) => [time, value])).toEqual([[0, 0], [2, 30]]);
  // Удлинение участка сдвигает всё, что после него, и удлиняет ролик.
  animation = setSegmentLength(animation, ["camera.azimuth"], 0, 1, 2.5);
  expect(keys(animation, "camera.azimuth").map(([time]) => time)).toEqual([0, 2.5, 3.5]);
  expect(animation.duration).toBe(3.5);
  // Укороченный ролик прижимает ключи к концу, а не удаляет их.
  const short = withDuration(animation, 2);
  expect(keys(short, "camera.azimuth").map(([time, value]) => [time, value])).toEqual([[0, 0], [2, 60]]);
});

test("проект: анимация сохраняется, старые проекты открываются без изменений вида", () => {
  let animation = setKey(setKey(EMPTY_ANIMATION, "camera.zoom", 0, 100), "camera.zoom", 1.5, 140);
  animation = setEase(animation, ["camera.zoom"], 0, 1.5, "outBack");
  const restored = parseAnimation(JSON.parse(JSON.stringify(serializeAnimation(animation))));
  expect(keys(restored, "camera.zoom").map(([time, value]) => [time, value])).toEqual([[0, 100], [1.5, 140]]);
  expect(restored.tracks["camera.zoom"]![0].ease).toBe("outBack");
  // Проект до пресетов тени, положения устройства и анимации.
  const legacy = { app: "forma", version: 1, imageData: null, settings: { ...DEFAULT_SETTINGS, shadow: { enabled: true, opacity: 35, softness: 50, distance: 30 }, transform: undefined } };
  const parsed = parseProject(JSON.stringify(legacy));
  expect(parsed.settings.shadow).toEqual(DEFAULT_SETTINGS.shadow);
  expect(parsed.settings.transform).toEqual(DEFAULT_SETTINGS.transform);
  expect(parsed.animation.tracks).toEqual({});
  // Изменённая вручную тень открывается своей, а не одним из пресетов.
  const custom = parseProject(JSON.stringify({ ...legacy, settings: { ...legacy.settings, shadow: { enabled: true, opacity: 61, softness: 50, distance: 30 } } }));
  expect(custom.settings.shadow.preset).toBe("custom");
});

test("движения камеры: начало и конец по описанию, экран в центре кадра", () => {
  const layout: SceneLayout = { size: [0.98, 2, 0.16], center: [0, 0, 0], screen: [0, 0.02, 0.08], screenHeight: 1.9 };
  const [pullBack, riseUp, pushIn] = ["pullBack", "riseUp", "pushIn"].map((id) => CAMERA_MOVES.find((move) => move.id === id)!);
  const sample = (move: typeof pullBack) => {
    const animation = applyCameraMove(EMPTY_ANIMATION, move, layout, 4 / 3, 0);
    return [evaluate(DEFAULT_SETTINGS, animation, 0).camera, evaluate(DEFAULT_SETTINGS, animation, move.duration).camera];
  };
  const [closeStart, wideEnd] = sample(pullBack);
  expect(closeStart.distance).toBeLessThan(wideEnd.distance / 2);
  expect(Math.abs(closeStart.azimuth)).toBeGreaterThan(5);
  expect([wideEnd.azimuth, wideEnd.elevation]).toEqual([0, 0]);
  const [low, front] = sample(riseUp);
  expect(low.elevation).toBeLessThan(-20);
  expect(front.elevation).toBe(0);
  const [wideStart, closeEnd] = sample(pushIn);
  expect(closeEnd.distance).toBeLessThan(wideStart.distance / 2);
  // Сдвиг кадра возвращает центр экрана в центр: проверяем на самой точке экрана.
  const shot = { azimuth: 20, elevation: 10, distance: 2, focalLength: 55, zoom: 100 };
  const { offsetX, offsetY } = focusOffset(shot, [0.3, 0.2, 0], 4 / 3);
  expect(offsetX).toBeLessThan(0);
  expect(offsetY).toBeGreaterThan(0);
  expect(focusOffset(shot, [0, 0, 0], 4 / 3)).toEqual({ offsetX: 0, offsetY: 0 });
});
