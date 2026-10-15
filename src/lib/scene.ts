import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { deviceFinish, deviceModel, finishScreens, type DeviceModel, type ScreenConfig } from "./models";
import { SpecularGlossinessPlugin } from "./spec-gloss";
import { recolor } from "./recolor";
import { FOLD_OPEN, FOLD_OUTER_BELOW, clamp, videoEnd, type CameraSettings, type Settings } from "./settings";
import { backgroundPreset, paintBackground } from "./backgrounds";
import { StudioLight, shadowDirection } from "./studio-light";
import { BackdropShadow, type ShadowOptions } from "./shadow";

type LoadState = { status: "loading" | "ready" | "error"; message?: string };
type Callbacks = {
  camera: (camera: CameraSettings) => void;
  model: (state: LoadState) => void;
  /** Активный экран сменился: его размер в пикселях. */
  screen: (size: { width: number; height: number }) => void;
  /** Видео на экране пошло или встало: кнопка в панели идёт за сценой. */
  video?: (playing: boolean) => void;
};

/** Ждёт, пока видео реально встанет на запрошенную секунду. */
function seek(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    if (Math.abs(video.currentTime - time) < 0.01) { resolve(); return; }
    const done = () => { video.removeEventListener("seeked", done); resolve(); };
    video.addEventListener("seeked", done);
    video.currentTime = time;
  });
}

/** Кодеки по убыванию качества; берём первый, который умеет браузер. */
function recorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

/** Умеет ли браузер записывать экспорт в видео. */
export function canExportVideo(): boolean {
  return recorderMime() !== null && typeof HTMLCanvasElement.prototype.captureStream === "function";
}

/**
 * Цвет тени берётся от фона: на цветном фоне настоящая тень — тёмный оттенок
 * того же цвета, а не серое пятно. На прозрачном и своём фоне тень чёрная.
 */
function shadowColor(background: Settings["background"]): THREE.Color {
  const color = background.mode === "solid" ? new THREE.Color(background.color)
    : background.mode === "gradient" ? new THREE.Color(background.color).lerp(new THREE.Color(background.secondary), 0.5)
    : background.mode === "preset" ? new THREE.Color(backgroundPreset(background.preset).base)
    : new THREE.Color(0x000000);
  return color.multiplyScalar(0.12);
}

function disposeObject(object: THREE.Object3D) {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}

function roundedShape(width: number, height: number, radius: number) {
  const x = -width / 2, y = -height / 2, r = Math.min(radius, width / 2, height / 2);
  const shape = new THREE.Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/**
 * Плоскость экрана в локальных координатах меша. Экран не всегда смотрит
 * вдоль оси Z: у ноутбука он наклонён вместе с крышкой, у внешнего экрана Duo
 * развёрнут назад. Нормаль берётся из треугольников, верх — мировая ось Y,
 * спроецированная на плоскость, поэтому картинка стоит прямо при любом
 * наклоне.
 */
interface ScreenFrame { u: THREE.Vector3; v: THREE.Vector3; normal: THREE.Vector3; minU: number; minV: number; width: number; height: number; top: number }

function screenFrame(mesh: THREE.Mesh, root: THREE.Object3D, mirror: boolean): ScreenFrame {
  const positions = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const normal = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const count = index ? index.count : positions.count;
  for (let corner = 0; corner + 2 < count; corner += 3) {
    a.fromBufferAttribute(positions, index ? index.getX(corner) : corner);
    b.fromBufferAttribute(positions, index ? index.getX(corner + 1) : corner + 1);
    c.fromBufferAttribute(positions, index ? index.getX(corner + 2) : corner + 2);
    normal.add(b.sub(a).cross(c.sub(a)));
  }
  normal.normalize();
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  // Верх — ось Y сцены, а не файла: файл бывает повёрнут при загрузке.
  const toLocal = mesh.matrixWorld.clone().invert();
  const v = new THREE.Vector3(0, 1, 0).transformDirection(toLocal).projectOnPlane(normal);
  if (v.lengthSq() < 1e-8) v.set(0, 0, -1).transformDirection(toLocal).projectOnPlane(normal);
  v.normalize();
  const u = new THREE.Vector3().crossVectors(v, normal).normalize();
  // Зеркальное преобразование в иерархии разворачивает изображение.
  if (toRoot.determinant() < 0 !== mirror) u.negate();
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity, top = -Infinity;
  for (let vertex = 0; vertex < positions.count; vertex++) {
    a.fromBufferAttribute(positions, vertex);
    minU = Math.min(minU, a.dot(u)); maxU = Math.max(maxU, a.dot(u));
    minV = Math.min(minV, a.dot(v)); maxV = Math.max(maxV, a.dot(v));
    top = Math.max(top, a.dot(normal));
  }
  return { u, v, normal, minU, minV, width: maxU - minU, height: maxV - minV, top };
}

function mapScreenUV(geometry: THREE.BufferGeometry, frame: ScreenFrame) {
  const positions = geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index);
    uvs[index * 2] = (point.dot(frame.u) - frame.minU) / frame.width;
    uvs[index * 2 + 1] = (point.dot(frame.v) - frame.minV) / frame.height;
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

/** Экран модели: у Duo их два, изображение выводится на активный. */
interface ScreenSlot { mesh: THREE.Mesh; aspect: number; inset: [number, number]; width?: number; cutout: THREE.Object3D[]; patch: THREE.Mesh | null }

/**
 * Насколько сложен телефон в каждый ключ клипа шарнира, в градусах: сумма
 * поворотов всех суставов от первого кадра. Клип идёт с плавным разгоном,
 * поэтому время под нужный угол ищется по этой таблице, а не пропорцией.
 */
function foldTable(clip: THREE.AnimationClip): { times: number[]; folded: number[] } {
  const tracks = clip.tracks.filter((track): track is THREE.QuaternionKeyframeTrack => track instanceof THREE.QuaternionKeyframeTrack);
  const times = Array.from(tracks[0]?.times ?? []);
  const first = new THREE.Quaternion(), current = new THREE.Quaternion();
  const folded = times.map((_, key) => tracks.reduce((sum, track) => {
    if (track.times.length !== times.length) return sum;
    first.fromArray(track.values, 0); current.fromArray(track.values, key * 4);
    return sum + THREE.MathUtils.radToDeg(first.angleTo(current));
  }, 0));
  return { times, folded };
}

function clipTime({ times, folded }: { times: number[]; folded: number[] }, target: number) {
  for (let key = 1; key < times.length; key++) {
    if (folded[key] < target) continue;
    const span = folded[key] - folded[key - 1];
    return span > 0 ? THREE.MathUtils.lerp(times[key - 1], times[key], (target - folded[key - 1]) / span) : times[key];
  }
  return times.at(-1) ?? 0;
}

/** Крышка ноутбука: исходная поза и шарнир в координатах её родителя. */
interface LidHinge { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; pivot: THREE.Vector3; axis: THREE.Vector3; angle: number }

/**
 * Шарнир крышки: задний верхний край корпуса под ней. Ось направлена так,
 * чтобы положительный поворот закрывал крышку, то есть вёл её к клавиатуре.
 */
function lidHinge(root: THREE.Object3D, { node: name, angle, hinge }: NonNullable<DeviceModel["lid"]>): LidHinge | null {
  const node = root.getObjectByName(name);
  if (!node?.parent) return null;
  const lid = new THREE.Box3().setFromObject(node);
  const base = new THREE.Box3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    let inside = false;
    object.traverseAncestors((ancestor) => { if (ancestor === node) inside = true; });
    if (!inside) base.expandByObject(object);
  });
  const lidCenter = lid.getCenter(new THREE.Vector3()), baseCenter = base.getCenter(new THREE.Vector3());
  const back = lidCenter.z < baseCenter.z;
  const toParent = node.parent.matrixWorld.clone().invert();
  const thickness = base.max.y - base.min.y;
  const pivot = new THREE.Vector3(0, base.max.y - hinge[0] * thickness, back ? base.min.z + hinge[1] * thickness : base.max.z - hinge[1] * thickness).applyMatrix4(toParent);
  const axis = new THREE.Vector3(back ? 1 : -1, 0, 0).transformDirection(toParent);
  return { node, position: node.position.clone(), quaternion: node.quaternion.clone(), pivot, axis, angle };
}

export class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly orthographic = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.01, 100);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly device = new THREE.Group();
  /** Устройство в координатах группы device: по нему ставится тень на фоне. */
  private bounds: THREE.Box3 | null = null;
  private readonly shadow = new BackdropShadow();
  private shadowOptions: ShadowOptions | null = null;
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly studio: StudioLight;
  private readonly screenCanvas = document.createElement("canvas");
  private readonly screenTexture: THREE.CanvasTexture;
  private readonly screenMaterial: THREE.MeshBasicMaterial;
  /** Неактивный экран Duo: выключенная матрица. */
  private readonly offMaterial = new THREE.MeshBasicMaterial({ color: 0x080909, toneMapped: false });
  private reflectionMaterial: THREE.MeshPhysicalMaterial | null = null;
  private backgroundTexture: THREE.CanvasTexture | null = null;
  /** Холст пресетного фона переиспользуется: он перерисовывается каждый кадр. */
  private readonly presetCanvas = document.createElement("canvas");
  private presetTexture: THREE.CanvasTexture | null = null;
  private backgroundAnimated = false;
  /** Системная настройка «уменьшить анимацию»: при ней фон не движется. */
  private readonly calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** Своё фото или видео позади устройства. */
  private backdropTexture: THREE.Texture | null = null;
  private backdropVideo: HTMLVideoElement | null = null;
  private backdropAspect = 1;
  private backdropRequest = 0;
  private backgroundSeconds = 0;
  private lastTick = 0;
  private screenImage: HTMLImageElement | null = null;
  private screenVideo: HTMLVideoElement | null = null;
  private screens = new Map<"main" | "outer", ScreenSlot>();
  private screen: ScreenSlot | null = null;
  private model: THREE.Group | null = null;
  private normalized: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private folds: ReturnType<typeof foldTable> | null = null;
  private lid: LidHinge | null = null;
  private settings: Settings;
  private frame = 0;
  private publishFrame = 0;
  private modelRequest = 0;
  private imageRequest = 0;
  private width = 1;
  private height = 1;
  private needsRender = true;
  private applyingCamera = false;
  private exporting = false;
  private disposed = false;
  private interacting = false;

  constructor(private readonly host: HTMLElement, initial: Settings, private readonly callbacks: Callbacks) {
    this.settings = structuredClone(initial);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Нейтральная кривая Khronos сделана для предметных рендеров: она сохраняет
    // цвет корпуса и не давит тени, как ACES.
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute("aria-label", "3D-превью устройства. Перетаскивайте для вращения, удерживайте Space для перемещения рабочей области.");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.host.appendChild(this.renderer.domElement);
    this.studio = new StudioLight(this.renderer);
    this.scene.add(this.device, this.shadow.plane);
    this.presetCanvas.width = 512;
    this.presetCanvas.height = 512;
    this.screenCanvas.width = 1290;
    this.screenCanvas.height = 2796;
    this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    this.screenTexture.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    this.screenMaterial = new THREE.MeshBasicMaterial({ map: this.screenTexture, toneMapped: false });
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.controls.dampingFactor = 0.16;
    this.controls.enablePan = false;
    this.controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    this.controls.minDistance = 1.15;
    this.controls.maxDistance = 15;
    this.controls.minZoom = 0.25;
    this.controls.maxZoom = 4;
    this.controls.rotateSpeed = 0.65;
    this.controls.addEventListener("start", this.handleStart);
    this.controls.addEventListener("change", this.handleCameraChange);
    this.controls.addEventListener("end", this.handleEnd);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
    this.applyCamera();
    this.applyEnvironment();
    void this.loadModel();
    this.tick();
  }

  private handleContextLost = (event: Event) => {
    event.preventDefault();
    this.callbacks.model({ status: "error", message: "Браузер прервал работу 3D. Нажмите «Повторить», чтобы восстановить сцену." });
  };

  private handleStart = () => { this.interacting = true; };
  private handleEnd = () => { this.interacting = false; this.publishCamera(); };
  private handleCameraChange = () => {
    this.needsRender = true;
    if (this.applyingCamera || this.exporting) return;
    const spherical = new THREE.Spherical().setFromVector3(this.camera.position);
    this.settings.camera = {
      ...this.settings.camera,
      azimuth: THREE.MathUtils.radToDeg(spherical.theta),
      elevation: clamp(90 - THREE.MathUtils.radToDeg(spherical.phi), -89, 89),
      distance: spherical.radius,
      zoom: this.camera.zoom * 100,
    };
    if (!this.publishFrame) this.publishFrame = requestAnimationFrame(() => { this.publishFrame = 0; this.publishCamera(); });
  };

  private publishCamera() {
    if (!this.disposed) this.callbacks.camera({ ...this.settings.camera });
  }

  private tick = () => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.exporting) return;
    this.controls.update();
    this.advance();
    if (this.needsRender || this.interacting) {
      this.draw();
      this.needsRender = false;
    }
  };

  /** Кадр целиком: сначала тень под текущий ракурс, затем сцена. */
  private draw() {
    this.shadow.update(this.renderer, this.scene, this.device, this.bounds, this.camera, this.shadowOptions);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Движение между кадрами: орбиты пятен фона и текущий кадр видео. Шаг
   * считается от реального времени и ограничен сверху, иначе после паузы во
   * вкладке фон прыгнул бы вперёд на всю паузу.
   */
  private advance() {
    const now = performance.now();
    const elapsed = this.lastTick ? Math.min((now - this.lastTick) / 1000, 0.1) : 0;
    this.lastTick = now;
    if (this.backgroundAnimated) {
      this.backgroundSeconds += elapsed * (this.settings.background.speed / 100);
      this.paintPreset();
      this.needsRender = true;
    }
    if (this.backdropVideo && !this.backdropVideo.paused) this.needsRender = true;
    const video = this.screenVideo;
    if (!video || video.paused || video.ended) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const end = videoEnd(this.settings.video.end, duration);
    const start = clamp(this.settings.video.start, 0, Math.max(0, duration - 0.05));
    // Зацикливание делаем сами, а не флагом loop: отрезок может быть обрезан.
    if (video.currentTime >= end - 0.02) {
      if (this.settings.video.loop) video.currentTime = start;
      else { video.pause(); this.callbacks.video?.(false); }
    }
    this.drawScreen();
  }

  /**
   * Своё фото или видео кладётся на фон «по заполнению»: текстура не тянется,
   * а обрезается через repeat и offset. Пересчитывается на каждом изменении
   * пропорций кадра, включая экспорт в другом размере.
   */
  private fitBackdrop(viewAspect: number) {
    const texture = this.backdropTexture;
    if (!texture || !this.backdropAspect) return;
    if (viewAspect > this.backdropAspect) {
      const part = this.backdropAspect / viewAspect;
      texture.repeat.set(1, part);
      texture.offset.set(0, (1 - part) / 2);
    } else {
      const part = viewAspect / this.backdropAspect;
      texture.repeat.set(part, 1);
      texture.offset.set((1 - part) / 2, 0);
    }
    this.needsRender = true;
  }

  /** Ставит своё фото или видео на фон. Пустая ссылка снимает его. */
  async setBackdrop(url: string, kind: "image" | "video") {
    const request = ++this.backdropRequest;
    if (!url) { this.releaseBackdrop(); this.applyEnvironment(); return; }
    if (kind === "video") {
      const video = document.createElement("video");
      video.src = url; video.muted = true; video.loop = true; video.playsInline = true; video.preload = "auto";
      await new Promise<void>((resolve, reject) => {
        video.onloadeddata = () => resolve();
        video.onerror = () => reject(new Error("Не удалось прочитать видео фона."));
      });
      if (request !== this.backdropRequest || this.disposed) { video.removeAttribute("src"); video.load(); return; }
      this.releaseBackdrop();
      const texture = new THREE.VideoTexture(video);
      texture.colorSpace = THREE.SRGBColorSpace;
      this.backdropTexture = texture;
      this.backdropVideo = video;
      this.backdropAspect = video.videoWidth / Math.max(1, video.videoHeight);
      await video.play().catch(() => undefined);
    } else {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (request !== this.backdropRequest || this.disposed) return;
      this.releaseBackdrop();
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      this.backdropTexture = texture;
      this.backdropAspect = image.naturalWidth / Math.max(1, image.naturalHeight);
    }
    this.applyEnvironment();
  }

  private releaseBackdrop() {
    this.backdropTexture?.dispose();
    this.backdropTexture = null;
    const video = this.backdropVideo;
    this.backdropVideo = null;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  private paintPreset() {
    const context = this.presetCanvas.getContext("2d");
    if (!context) return;
    paintBackground(context, backgroundPreset(this.settings.background.preset), this.presetCanvas.width, this.backgroundSeconds);
    if (this.presetTexture) this.presetTexture.needsUpdate = true;
  }

  private resize() {
    if (this.disposed || this.exporting) return;
    this.width = Math.max(1, Math.round(this.host.clientWidth));
    this.height = Math.max(1, Math.round(this.host.clientHeight));
    this.renderer.setSize(this.width, this.height, false);
    this.updateProjection(this.width, this.height);
    this.fitBackdrop(this.width / Math.max(1, this.height));
    this.needsRender = true;
  }

  private updateProjection(width: number, height: number) {
    this.fitBackdrop(width / Math.max(1, height));
    const ratio = width / height;
    this.perspective.aspect = ratio;
    this.perspective.setFocalLength(this.settings.camera.focalLength);
    const halfHeight = 1.48;
    this.orthographic.left = -halfHeight * ratio;
    this.orthographic.right = halfHeight * ratio;
    this.orthographic.top = halfHeight;
    this.orthographic.bottom = -halfHeight;
    for (const camera of [this.perspective, this.orthographic]) {
      camera.setViewOffset(width, height, -width * this.settings.camera.offsetX / 100, height * this.settings.camera.offsetY / 100, width, height);
      camera.updateProjectionMatrix();
    }
  }

  private applyCamera() {
    this.applyingCamera = true;
    const damping = this.controls.enableDamping;
    this.controls.enableDamping = false;
    this.controls.update();
    const { projection, azimuth, elevation, distance, zoom, roll } = this.settings.camera;
    this.camera = projection === "perspective" ? this.perspective : this.orthographic;
    this.controls.object = this.camera;
    this.camera.position.setFromSphericalCoords(distance, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
    this.camera.zoom = zoom / 100;
    this.camera.lookAt(0, 0, 0);
    this.controls.target.set(0, 0, 0);
    this.device.rotation.z = THREE.MathUtils.degToRad(roll);
    this.updateProjection(this.width, this.height);
    this.controls.update();
    this.controls.enableDamping = damping;
    this.applyingCamera = false;
    this.needsRender = true;
  }

  private applyEnvironment() {
    const { light, background, screen, shadow } = this.settings;
    // Весь свет — софтбоксы в карте окружения; поворот вращает их вокруг устройства.
    const rotation = THREE.MathUtils.degToRad(light.rotation);
    this.scene.environment = this.studio.environment(light.preset);
    this.scene.environmentIntensity = light.intensity / 100;
    this.scene.environmentRotation.y = rotation;
    this.renderer.toneMappingExposure = light.exposure / 100;
    this.shadowOptions = shadow.enabled ? {
      opacity: shadow.opacity / 100, softness: shadow.softness / 100, distance: shadow.distance / 100,
      color: shadowColor(background), from: shadowDirection(light.preset).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation),
    } : null;
    this.backgroundTexture?.dispose();
    this.backgroundTexture = null;
    this.backgroundAnimated = background.mode === "preset" && background.animated && !this.calm;
    if (background.mode === "custom") {
      // Пока своё фото или видео не загружено, показываем ровный цвет, иначе
      // сцена осталась бы с прошлым фоном и выбор выглядел бы сломанным.
      if (this.backdropTexture) { this.scene.background = this.backdropTexture; this.fitBackdrop(this.width / Math.max(1, this.height)); }
      else this.scene.background = new THREE.Color(background.color);
    }
    else if (background.mode === "transparent") this.scene.background = null;
    else if (background.mode === "solid") this.scene.background = new THREE.Color(background.color);
    else if (background.mode === "preset") {
      if (!this.presetTexture) {
        this.presetTexture = new THREE.CanvasTexture(this.presetCanvas);
        this.presetTexture.colorSpace = THREE.SRGBColorSpace;
      }
      this.paintPreset();
      this.scene.background = this.presetTexture;
    } else {
      const canvas = document.createElement("canvas");
      canvas.width = 512; canvas.height = 512;
      const context = canvas.getContext("2d");
      if (context) {
        const radians = THREE.MathUtils.degToRad(background.angle);
        const x = Math.cos(radians) * 362, y = Math.sin(radians) * 362;
        const gradient = context.createLinearGradient(256 - x, 256 - y, 256 + x, 256 + y);
        gradient.addColorStop(0, background.color); gradient.addColorStop(1, background.secondary);
        context.fillStyle = gradient; context.fillRect(0, 0, 512, 512);
        this.backgroundTexture = new THREE.CanvasTexture(canvas);
        this.backgroundTexture.colorSpace = THREE.SRGBColorSpace;
        this.scene.background = this.backgroundTexture;
      }
    }
    // Вырез прячется только на активном экране; на втором он остаётся как есть.
    this.screens.forEach((slot) => {
      const hide = slot === this.screen && !screen.island;
      slot.cutout.forEach((object) => { object.visible = !hide; });
      if (slot.patch) slot.patch.visible = hide;
    });
    if (this.reflectionMaterial) this.reflectionMaterial.opacity = screen.reflection / 100;
    this.needsRender = true;
  }

  update(next: Settings) {
    const old = this.settings;
    this.settings = structuredClone(next);
    if (JSON.stringify(old.camera) !== JSON.stringify(next.camera)) this.applyCamera();
    if (JSON.stringify(old.screen) !== JSON.stringify(next.screen)) this.drawScreen();
    if (JSON.stringify([old.light, old.shadow, old.background, old.screen.island, old.screen.reflection]) !== JSON.stringify([next.light, next.shadow, next.background, next.screen.island, next.screen.reflection])) this.applyEnvironment();
    if (JSON.stringify(old.video) !== JSON.stringify(next.video)) this.applyVideo();
    if (old.device !== next.device || old.finish !== next.finish) void this.loadModel();
    else if (old.fold !== next.fold || old.lid !== next.lid) this.applyPose();
  }

  setInteractionEnabled(enabled: boolean) {
    this.controls.enabled = enabled && !this.exporting;
  }

  /**
   * Плотность пикселей превью под текущий масштаб рабочей области. Холст
   * увеличивается средствами CSS, поэтому без этого наезд просто растягивает
   * уже отрисованный кадр и модель выглядит ступенчатой. Потолок считается от
   * размера холста, чтобы буфер не вырос за пределы разумного на больших
   * экранах. На экспорт не влияет: там своя плотность и свой размер.
   */
  setViewScale(scale: number) {
    if (this.disposed || this.exporting) return;
    const base = Math.min(window.devicePixelRatio, 2);
    const ceiling = Math.max(base, Math.min(4, 4096 / Math.max(this.width, this.height, 1)));
    const next = clamp(base * scale, base, ceiling);
    if (Math.abs(next - this.renderer.getPixelRatio()) < 0.01) return;
    this.renderer.setPixelRatio(next);
    this.renderer.setSize(this.width, this.height, false);
    this.needsRender = true;
  }

  /** Активная область экрана в пикселях холста, без чёрной рамки монитора:
   *  под неё снимаются сайты и фреймы Figma, а у модели без родного разрешения её размер советуется для скриншота. */
  get screenSize() {
    const [insetX, insetY] = this.screen?.inset ?? [0, 0];
    return { width: Math.round(this.screenCanvas.width * (1 - insetX * 2)), height: Math.round(this.screenCanvas.height * (1 - insetY * 2)) };
  }

  /** Возвращает экран к пустому состоянию. */
  clearImage() {
    this.imageRequest++;
    this.screenImage = null;
    this.releaseVideo();
    this.drawScreen();
  }

  async setImage(url: string) {
    const request = ++this.imageRequest;
    const image = new Image();
    image.src = url;
    await image.decode();
    if (request !== this.imageRequest || this.disposed) return;
    this.releaseVideo();
    this.screenImage = image;
    this.drawScreen();
  }

  /**
   * Ставит видео на экран. Кадры попадают туда же, куда и картинка — в
   * холст экрана, — поэтому вписывание, масштаб, сдвиг и заплатка выреза
   * работают без изменений.
   */
  async setVideo(url: string) {
    const request = ++this.imageRequest;
    const video = document.createElement("video");
    video.src = url;
    video.muted = this.settings.video.muted;
    video.playsInline = true;
    video.preload = "auto";
    video.loop = false;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Не удалось прочитать видео. Выберите MP4 или WebM."));
    });
    if (request !== this.imageRequest || this.disposed) { video.removeAttribute("src"); video.load(); return; }
    this.releaseVideo();
    this.screenImage = null;
    this.screenVideo = video;
    video.playbackRate = clamp(this.settings.video.speed / 100, 0.25, 4);
    await seek(video, clamp(this.settings.video.start, 0, video.duration || 0));
    // Автозапуск со звуком браузер заблокирует; беззвучное видео пойдёт сразу.
    await video.play().catch(() => undefined);
    this.callbacks.video?.(!video.paused);
    this.drawScreen();
  }

  private releaseVideo() {
    const video = this.screenVideo;
    this.screenVideo = null;
    if (!video) return;
    video.pause();
    video.removeAttribute("src");
    video.load();
  }

  /** Что сейчас выводится на экран: кадр видео имеет приоритет над картинкой. */
  private get screenSource(): { element: CanvasImageSource; width: number; height: number } | null {
    const video = this.screenVideo;
    if (video && video.videoWidth) return { element: video, width: video.videoWidth, height: video.videoHeight };
    const image = this.screenImage;
    if (image) return { element: image, width: image.naturalWidth, height: image.naturalHeight };
    return null;
  }

  get hasVideo() { return this.screenVideo !== null; }
  get videoPlaying() { return this.screenVideo !== null && !this.screenVideo.paused; }
  get videoTime() { return this.screenVideo?.currentTime ?? 0; }

  async playVideo() {
    const video = this.screenVideo;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const end = videoEnd(this.settings.video.end, duration);
    const start = clamp(this.settings.video.start, 0, Math.max(0, duration - 0.05));
    if (video.currentTime >= end - 0.02) await seek(video, start);
    await video.play().catch(() => undefined);
    this.callbacks.video?.(!video.paused);
  }

  pauseVideo() {
    this.screenVideo?.pause();
    this.callbacks.video?.(false);
  }

  /** Применяет обрезку, скорость и звук к уже загруженному видео. */
  private applyVideo() {
    const video = this.screenVideo;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    video.muted = this.settings.video.muted;
    video.playbackRate = clamp(this.settings.video.speed / 100, 0.25, 4);
    const start = clamp(this.settings.video.start, 0, Math.max(0, duration - 0.05));
    const end = videoEnd(this.settings.video.end, duration);
    if (video.currentTime < start - 0.05 || video.currentTime > end + 0.05) {
      video.currentTime = start;
      this.drawScreen();
    }
  }

  private drawScreen() {
    const context = this.screenCanvas.getContext("2d");
    if (!context) return;
    const { fit, scale, x, y } = this.settings.screen;
    const [insetX, insetY] = this.screen?.inset ?? [0, 0];
    const left = this.screenCanvas.width * insetX, top = this.screenCanvas.height * insetY;
    const width = this.screenCanvas.width - left * 2, height = this.screenCanvas.height - top * 2;
    const source = this.screenSource;
    context.fillStyle = "#080909";
    context.fillRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);
    if (source) {
      const ratio = (fit === "cover" ? Math.max(width / source.width, height / source.height) : Math.min(width / source.width, height / source.height)) * scale / 100;
      const drawWidth = source.width * ratio, drawHeight = source.height * ratio;
      // Рамка монитора остаётся чёрной: изображение обрезается по активной области.
      context.save();
      context.beginPath(); context.rect(left, top, width, height); context.clip();
      context.drawImage(source.element, left + (width - drawWidth) / 2 + x / 100 * width, top + (height - drawHeight) / 2 + y / 100 * height, drawWidth, drawHeight);
      context.restore();
    }
    this.screenTexture.needsUpdate = true;
    this.needsRender = true;
  }

  /**
   * Готовит экран модели: развёртку под изображение, отражение на стекле и
   * заплатку на месте выреза камеры. Всё строится в локальных координатах
   * меша и вешается на него же, поэтому повторяет движение шарнира Duo.
   */
  private buildScreen(root: THREE.Object3D, config: ScreenConfig, reflectionMaterial: THREE.Material): ScreenSlot {
    let found: THREE.Mesh | undefined;
    root.traverse((object) => { if (object instanceof THREE.Mesh && object.name === config.mesh) found = object; });
    if (!found) throw new Error("В модели не найдена поверхность экрана.");
    const mesh: THREE.Mesh = found;
    const frame = screenFrame(mesh, root, config.mirror ?? false);
    mesh.geometry = mesh.geometry.clone();
    mapScreenUV(mesh.geometry, frame);
    const oldMaterial = mesh.material;
    mesh.material = this.offMaterial;
    for (const material of Array.isArray(oldMaterial) ? oldMaterial : [oldMaterial]) {
      for (const texture of Object.values(material)) if (texture instanceof THREE.Texture) texture.dispose();
      material.dispose();
    }
    if (mesh instanceof THREE.SkinnedMesh) {
      const reflection = new THREE.SkinnedMesh(mesh.geometry, reflectionMaterial);
      reflection.position.copy(mesh.position); reflection.quaternion.copy(mesh.quaternion); reflection.scale.copy(mesh.scale);
      mesh.parent?.add(reflection);
      reflection.bind(mesh.skeleton, mesh.bindMatrix);
    } else mesh.add(new THREE.Mesh(mesh.geometry, reflectionMaterial));
    const cutout: THREE.Object3D[] = [];
    root.traverse((object) => { if (config.cutout.includes(object.name)) cutout.push(object); });
    let patch: THREE.Mesh | null = null;
    if (cutout.length) {
      const toScreen = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
      const point = new THREE.Vector3();
      let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      cutout.forEach((object) => object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const positions = child.geometry.getAttribute("position");
        const matrix = toScreen.clone().multiply(child.matrixWorld);
        for (let index = 0; index < positions.count; index++) {
          point.fromBufferAttribute(positions, index).applyMatrix4(matrix);
          minU = Math.min(minU, point.dot(frame.u)); maxU = Math.max(maxU, point.dot(frame.u));
          minV = Math.min(minV, point.dot(frame.v)); maxV = Math.max(maxV, point.dot(frame.v));
        }
      }));
      const pad = frame.height * 0.0005;
      const width = maxU - minU + pad, height = maxV - minV + pad;
      const geometry = new THREE.ShapeGeometry(roundedShape(width, height, Math.min(width, height) / 2), 32);
      const center = frame.u.clone().multiplyScalar((minU + maxU) / 2).addScaledVector(frame.v, (minV + maxV) / 2).addScaledVector(frame.normal, frame.top + frame.height * 0.00002);
      geometry.applyMatrix4(new THREE.Matrix4().makeBasis(frame.u, frame.v, frame.normal).setPosition(center));
      mapScreenUV(geometry, frame);
      patch = new THREE.Mesh(geometry, this.screenMaterial);
      // Без своего блика заплатка темнее стекла вокруг и читается как точка.
      patch.add(new THREE.Mesh(geometry, reflectionMaterial));
      patch.visible = false;
      mesh.add(patch);
    }
    return { mesh, aspect: frame.width / frame.height, inset: config.inset ?? [0, 0], width: config.width, cutout, patch };
  }

  /**
   * Ставит шарнир Duo или крышку ноутбука, выбирает активный экран и заново
   * центрирует модель.
   */
  private applyPose() {
    const model = deviceModel(this.settings.device);
    if (!this.model || !this.normalized) return;
    const fold = model.fold ? this.settings.fold : FOLD_OPEN;
    if (this.mixer && this.folds) this.mixer.setTime(clipTime(this.folds, FOLD_OPEN - fold));
    // Клип поворачивает только левую половину. Модель поворачивается на
    // половину сгиба, чтобы половины стояли к камере симметрично: внутренней
    // стороной, пока изображение на внутреннем экране, и внешней, когда оно
    // переходит на внешний экран на обороте левой половины.
    const yaw = fold < FOLD_OUTER_BELOW ? fold / 2 : -(FOLD_OPEN - fold) / 2;
    this.normalized.rotation.y = THREE.MathUtils.degToRad(yaw);
    if (this.lid) {
      const { node, position, quaternion, pivot, axis, angle } = this.lid;
      const turn = new THREE.Quaternion().setFromAxisAngle(axis, THREE.MathUtils.degToRad(angle - this.settings.lid));
      node.position.copy(position).sub(pivot).applyQuaternion(turn).add(pivot);
      node.quaternion.copy(turn).multiply(quaternion);
    }
    const next = this.screens.get(model.fold && fold < FOLD_OUTER_BELOW ? "outer" : "main") ?? null;
    const changed = next !== this.screen;
    this.screens.forEach((slot) => { slot.mesh.material = slot === next ? this.screenMaterial : this.offMaterial; });
    if (next && changed) {
      // Телефон — в родной ширине Pro Max, 1290 px: в неё же снимается сайт по
      // ссылке. Горизонтальный экран ноутбука и монитора — 2796 px в ширину.
      const width = next.width ?? (next.aspect >= 1 ? 2796 : 1290);
      this.screenCanvas.width = width;
      this.screenCanvas.height = Math.round(width / next.aspect);
      // Размер холста поменялся: старое хранилище текстуры на GPU уже не подходит.
      this.screenTexture.dispose();
    }
    this.screen = next;
    if (next) this.callbacks.screen(this.screenSize);
    // Центр считается без поворота сцены, иначе крен сдвинет модель.
    const parent = this.model.parent;
    parent?.remove(this.model);
    this.normalized.position.set(0, 0, 0);
    this.model.updateMatrixWorld(true);
    // Рамка Duo пересчитывается по позе шарнира. Только после
    // updateMatrixWorld: до него у скиннинга устаревшая обратная матрица
    // привязки, и рамка уезжает на масштаб модели.
    this.model.traverse((object) => { if (object instanceof THREE.SkinnedMesh) object.computeBoundingBox(); });
    const center = new THREE.Box3().setFromObject(this.model).getCenter(new THREE.Vector3());
    this.normalized.position.copy(center).negate();
    this.model.updateMatrixWorld(true);
    this.bounds = new THREE.Box3().setFromObject(this.model);
    parent?.add(this.model);
    this.needsRender = true;
    // Крышка двигается ползунком: экран и свет перерисовываются только при
    // смене экрана, а не на каждый шаг.
    if (!changed) return;
    this.drawScreen();
    this.applyEnvironment();
  }

  private async loadModel() {
    const request = ++this.modelRequest;
    const model = deviceModel(this.settings.device);
    this.callbacks.model({ status: "loading" });
    try {
      const loader = new GLTFLoader().register((parser) => new SpecularGlossinessPlugin(parser));
      const finish = deviceFinish(model.id, this.settings.finish);
      const gltf = await loader.loadAsync(finish.path);
      if (this.disposed || request !== this.modelRequest) { disposeObject(gltf.scene); return; }
      const root = gltf.scene;
      // Текстуры корпуса приходят без анизотропии: под углом и на наезде их
      // пиксели размазываются сильнее, чем нужно. Логотип и надписи от этого
      // выигрывают заметнее всего.
      const anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          for (const value of Object.values(material)) {
            if (value instanceof THREE.Texture && value.anisotropy !== anisotropy) { value.anisotropy = anisotropy; value.needsUpdate = true; }
          }
        }
      });
      if (finish.recolor) {
        await recolor(root, finish.recolor.from, finish.recolor.to);
        if (this.disposed || request !== this.modelRequest) { disposeObject(root); return; }
      }
      root.rotation.x += THREE.MathUtils.degToRad(finish.rotateX ?? 0);
      root.rotation.y += model.rotateY;
      root.updateMatrixWorld(true);
      // Телефон вписывается по высоте, монитор — по ширине: иначе широкая
      // модель вылезает за кадр 4:3 в студийном ракурсе. Глубина ограничивает ноутбук: в
      // перспективе передний край клавиатуры иначе подъезжает к камере.
      // Планшет по высоте как телефон оказывается почти вдвое шире и упирается
      // в края кадра в студийном ракурсе, поэтому он чуть меньше.
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      const scale = Math.min(2 / size.y, 2.3 / size.x, 1.9 / size.z) * (model.kind === "tablet" ? 0.85 : 1);
      const normalized = new THREE.Group();
      normalized.add(root); normalized.scale.setScalar(scale);
      const replacement = new THREE.Group();
      replacement.add(normalized);
      replacement.updateMatrixWorld(true);
      const reflectionMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.15, transparent: true, opacity: this.settings.screen.reflection / 100, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const screens = new Map<"main" | "outer", ScreenSlot>();
      const configs = finishScreens(model.id, finish.id);
      try {
        screens.set("main", this.buildScreen(root, configs.main, reflectionMaterial));
        if (configs.outer) screens.set("outer", this.buildScreen(root, configs.outer, reflectionMaterial));
      } catch (error) { disposeObject(replacement); reflectionMaterial.dispose(); throw error; }
      const lid = model.lid ? lidHinge(root, model.lid) : null;
      let mixer: THREE.AnimationMixer | null = null;
      const clip = model.fold && gltf.animations.find((item) => item.name === model.fold?.clip);
      if (clip) {
        mixer = new THREE.AnimationMixer(root);
        const action = mixer.clipAction(clip);
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
        action.play();
      }
      if (this.model) {
        this.device.remove(this.model);
        // Материалы экрана общие для всех моделей; освобождаем только ресурсы старой модели.
        this.model.traverse((object) => { if (object instanceof THREE.Mesh && (object.material === this.screenMaterial || object.material === this.offMaterial)) object.material = new THREE.MeshBasicMaterial(); });
        disposeObject(this.model);
      }
      this.mixer?.stopAllAction();
      this.model = replacement;
      this.normalized = normalized;
      this.mixer = mixer;
      this.folds = clip ? foldTable(clip) : null;
      this.lid = lid;
      this.screens = screens;
      this.screen = null;
      this.reflectionMaterial = reflectionMaterial;
      this.device.add(replacement);
      this.applyPose();
      this.callbacks.model({ status: "ready" });
    } catch (error) {
      if (!this.disposed && request === this.modelRequest) this.callbacks.model({ status: "error", message: error instanceof Error ? error.message : "Не удалось загрузить модель. Попробуйте ещё раз." });
    }
  }

  async exportPNG(width: number, height: number): Promise<Blob> {
    if (this.exporting || this.disposed) throw new Error("Дождитесь завершения экспорта.");
    if (Math.max(width, height) > this.renderer.capabilities.maxTextureSize) throw new Error("Видеокарта не поддерживает это разрешение. Выберите меньший размер.");
    this.exporting = true;
    this.controls.enabled = false;
    const ratio = this.renderer.getPixelRatio();
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.updateProjection(width, height);
      this.draw();
      return await new Promise<Blob>((resolve, reject) => {
        this.renderer.domElement.toBlob((blob) => blob ? resolve(blob) : reject(new Error("Не удалось создать PNG. Выберите меньшее разрешение.")), "image/png");
      });
    } finally {
      this.renderer.setPixelRatio(ratio);
      this.exporting = false;
      this.controls.enabled = true;
      this.resize();
    }
  }

  /**
   * Записывает ролик с экрана в WebM. Запись идёт в реальном времени через
   * MediaRecorder: отрезок на пять секунд пишется пять секунд. Кадры снимаются
   * с того же холста, что и PNG, поэтому картинка в ролике и в снимке
   * совпадает. Звук исходного видео в ролик не попадает.
   */
  async exportVideo(width: number, height: number, fps: number, onProgress?: (value: number) => void): Promise<Blob> {
    const video = this.screenVideo;
    if (!video) throw new Error("Сначала загрузите видео на экран.");
    if (this.exporting || this.disposed) throw new Error("Дождитесь завершения экспорта.");
    const mimeType = recorderMime();
    if (!mimeType || typeof this.renderer.domElement.captureStream !== "function") throw new Error("Браузер не умеет записывать видео. Попробуйте Chrome, Edge или Firefox.");
    if (Math.max(width, height) > this.renderer.capabilities.maxTextureSize) throw new Error("Видеокарта не поддерживает это разрешение. Выберите меньший размер.");
    this.exporting = true;
    this.controls.enabled = false;
    const ratio = this.renderer.getPixelRatio();
    const wasPlaying = !video.paused;
    const seconds = this.backgroundSeconds;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.setSize(width, height, false);
      this.updateProjection(width, height);
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const start = clamp(this.settings.video.start, 0, Math.max(0, duration - 0.05));
      const end = videoEnd(this.settings.video.end, duration);
      video.pause();
      video.playbackRate = clamp(this.settings.video.speed / 100, 0.25, 4);
      await seek(video, start);
      this.drawScreen();
      this.draw();
      const stream = this.renderer.domElement.captureStream(fps);
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: Math.round(width * height * fps * 0.14) });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve(); });
      recorder.start();
      await video.play();
      await new Promise<void>((resolve) => {
        const step = () => {
          if (this.disposed) { resolve(); return; }
          this.drawScreen();
          if (this.backgroundAnimated) {
            this.backgroundSeconds += (1 / fps) * (this.settings.background.speed / 100);
            this.paintPreset();
          }
          this.draw();
          onProgress?.(clamp((video.currentTime - start) / Math.max(0.001, end - start), 0, 1));
          if (video.ended || video.currentTime >= end - 0.02) { resolve(); return; }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
      video.pause();
      recorder.stop();
      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      if (!chunks.length) throw new Error("Запись не получилась. Попробуйте меньшее разрешение или частоту кадров.");
      return new Blob(chunks, { type: mimeType });
    } finally {
      this.backgroundSeconds = seconds;
      this.renderer.setPixelRatio(ratio);
      this.exporting = false;
      this.controls.enabled = true;
      this.resize();
      if (wasPlaying) void video.play().catch(() => undefined);
      this.callbacks.video?.(!video.paused);
    }
  }

  dispose() {
    this.disposed = true;
    this.modelRequest++; this.imageRequest++;
    cancelAnimationFrame(this.frame); cancelAnimationFrame(this.publishFrame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    if (this.model) disposeObject(this.model);
    this.screenMaterial.dispose(); this.offMaterial.dispose(); this.screenTexture.dispose();
    this.releaseVideo(); this.releaseBackdrop();
    this.backgroundTexture?.dispose(); this.presetTexture?.dispose(); this.studio.dispose(); this.shadow.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
