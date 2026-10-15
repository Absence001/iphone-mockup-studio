import * as THREE from "three";
import type { Lighting } from "./settings";

/**
 * Студийный свет собран из больших софтбоксов, а не из точечных ламп.
 * Направленный свет даёт на полированной рамке и стекле тонкие резкие блики
 * и чёрные провалы между ними. Софтбокс в карте окружения отражается широкой
 * мягкой полосой, как на предметной съёмке, и заодно даёт рассеянный свет.
 */

interface Softbox {
  /** Центр в сцене: устройство стоит в начале координат экраном к +Z. */
  at: [number, number, number];
  size: [number, number];
  /** Яркость в линейных единицах; больше 1 — пересвет, как у настоящей лампы. */
  power: number;
}

interface Layout {
  boxes: Softbox[];
  /** Яркость стен комнаты: пол, горизонт и потолок. */
  room: [number, number, number];
  /** Откуда падает тень на фон: направление на главный софтбокс. */
  shadowFrom: [number, number, number];
}

const LAYOUTS: Record<Lighting, Layout> = {
  // Большой верхний софтбокс и почти равный ему заполняющий: перепад около 1,5 : 1.
  soft: {
    boxes: [
      // Верхний софтбокс сдвинут назад: в ракурсе снизу стекло и вырез камеры
      // отражают его под скользящим углом и выгорают до белого.
      { at: [0, 7, -1.5], size: [8, 6], power: 18 },
      { at: [-5.5, 2.5, 5], size: [5, 6], power: 24 },
      { at: [5.5, 1.5, 5], size: [5, 6], power: 16 },
      { at: [-6, 1, -4], size: [2, 8], power: 8 },
      { at: [6, 1, -4], size: [2, 8], power: 8 },
    ],
    room: [0.7, 0.55, 0.4],
    shadowFrom: [-0.35, 1, 0.6],
  },
  // Софтбокс сбоку: перепад около 4 : 1, грани корпуса читаются.
  studio: {
    boxes: [
      { at: [-6, 3, 3.5], size: [4.5, 7], power: 32 },
      { at: [6, 0.5, 4], size: [4, 5], power: 6 },
      { at: [0, 7, 0], size: [2.5, 9], power: 10 },
      { at: [5, 1, -5], size: [1.5, 8], power: 16 },
    ],
    room: [0.25, 0.2, 0.16],
    shadowFrom: [-1, 0.75, 0.6],
  },
  // Две полосы позади по бокам рисуют контур, спереди только слабая подсветка.
  rim: {
    boxes: [
      { at: [-6, 0.5, -2.5], size: [1.8, 9], power: 70 },
      { at: [6, 0.5, -2.5], size: [1.8, 9], power: 70 },
      { at: [0, 2.5, 7], size: [5, 4], power: 4 },
      { at: [0, 7, -1], size: [6, 3], power: 5 },
    ],
    room: [0.1, 0.08, 0.08],
    shadowFrom: [0, 1, 0.5],
  },
};

/** Направление на главный источник: по нему строится тень на фоне. */
export function shadowDirection(preset: Lighting): THREE.Vector3 {
  return new THREE.Vector3(...LAYOUTS[preset].shadowFrom).normalize();
}

/** Мягкий край софтбокса: яркость спадает к рамке, а не обрывается. */
function softboxTexture() {
  const size = 128, data = new Uint8Array(size * size * 4);
  const edge = (t: number) => THREE.MathUtils.smoothstep(Math.min(t, 1 - t), 0, 0.22);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const value = Math.round(255 * edge((x + 0.5) / size) * edge((y + 0.5) / size));
    data.set([value, value, value, 255], (y * size + x) * 4);
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.needsUpdate = true;
  return texture;
}

function studioScene(layout: Layout, texture: THREE.Texture) {
  const scene = new THREE.Scene();
  // Комната — сфера с плавным переходом от пола к потолку: металл всегда
  // что-то отражает, и в тени корпус не проваливается в чистый чёрный.
  const room = new THREE.SphereGeometry(12, 48, 24);
  const position = room.getAttribute("position"), colors = new Float32Array(position.count * 3);
  const [floor, horizon, ceiling] = layout.room;
  for (let index = 0; index < position.count; index++) {
    const height = position.getY(index) / 12;
    const value = height < 0 ? THREE.MathUtils.lerp(horizon, floor, THREE.MathUtils.smoothstep(-height, 0, 0.6)) : THREE.MathUtils.lerp(horizon, ceiling, THREE.MathUtils.smoothstep(height, 0, 0.8));
    colors.set([value, value, value], index * 3);
  }
  room.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(room, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const box of layout.boxes) {
    // Софтбокс складывается со стеной, поэтому мягкий край не оставляет рамки.
    const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    material.color.setScalar(box.power);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(...box.size), material);
    panel.position.set(...box.at);
    panel.lookAt(0, 0, 0);
    scene.add(panel);
  }
  return scene;
}

/** Карты окружения считаются один раз на схему и живут до закрытия сцены. */
export class StudioLight {
  private readonly maps = new Map<Lighting, THREE.WebGLRenderTarget>();

  constructor(private readonly renderer: THREE.WebGLRenderer) {}

  environment(preset: Lighting): THREE.Texture {
    let target = this.maps.get(preset);
    if (!target) {
      const texture = softboxTexture();
      const scene = studioScene(LAYOUTS[preset], texture);
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      target = pmrem.fromScene(scene, 0.03);
      pmrem.dispose();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        (object.material as THREE.Material).dispose();
      });
      texture.dispose();
      this.maps.set(preset, target);
    }
    return target.texture;
  }

  dispose() {
    this.maps.forEach((target) => target.dispose());
    this.maps.clear();
  }
}
