import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { activeScreen, deviceFinish, deviceModel, type ScreenConfig } from "./models";
import { SpecularGlossinessPlugin } from "./spec-gloss";
import { clamp, type CameraSettings, type Settings } from "./settings";

type LoadState = { status: "loading" | "ready" | "error"; message?: string };
type Callbacks = { camera: (camera: CameraSettings) => void; model: (state: LoadState) => void };

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
  const toLocal = toRoot.clone().invert();
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
interface ScreenSlot { mesh: THREE.Mesh; aspect: number; inset: [number, number]; cutout: THREE.Object3D[]; patch: THREE.Mesh | null }

export class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly orthographic = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.01, 100);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly device = new THREE.Group();
  private readonly lightRig = new THREE.Group();
  private readonly key = new THREE.DirectionalLight(0xfff8ed, 3);
  private readonly fill = new THREE.DirectionalLight(0xdde6ff, 2);
  private readonly rim = new THREE.DirectionalLight(0xffffff, 4);
  private readonly ambient = new THREE.HemisphereLight(0xffffff, 0x424047, 1.2);
  private readonly controls: OrbitControls;
  private readonly observer: ResizeObserver;
  private readonly environment: THREE.WebGLRenderTarget;
  private readonly screenCanvas = document.createElement("canvas");
  private readonly screenTexture: THREE.CanvasTexture;
  private readonly screenMaterial: THREE.MeshBasicMaterial;
  /** Неактивный экран Duo: выключенная матрица. */
  private readonly offMaterial = new THREE.MeshBasicMaterial({ color: 0x080909, toneMapped: false });
  private reflectionMaterial: THREE.MeshPhysicalMaterial | null = null;
  private backgroundTexture: THREE.CanvasTexture | null = null;
  private screenImage: HTMLImageElement | null = null;
  private screens = new Map<string, ScreenSlot>();
  private screen: ScreenSlot | null = null;
  private model: THREE.Group | null = null;
  private normalized: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.domElement.setAttribute("aria-label", "3D-превью устройства. Перетаскивайте для вращения, удерживайте Space для перемещения рабочей области.");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.host.appendChild(this.renderer.domElement);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(this.device);
    this.key.position.set(-3, 4, 5);
    this.fill.position.set(4, 1, 3);
    this.rim.position.set(-2, 2, -4);
    this.lightRig.add(this.key, this.fill, this.rim);
    this.scene.add(this.lightRig, this.ambient);
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
    if (this.needsRender || this.interacting) {
      this.renderer.render(this.scene, this.camera);
      this.needsRender = false;
    }
  };

  private resize() {
    if (this.disposed || this.exporting) return;
    this.width = Math.max(1, Math.round(this.host.clientWidth));
    this.height = Math.max(1, Math.round(this.host.clientHeight));
    this.renderer.setSize(this.width, this.height, false);
    this.updateProjection(this.width, this.height);
    this.needsRender = true;
  }

  private updateProjection(width: number, height: number) {
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
    const { light, background, screen } = this.settings;
    const strength = light.intensity / 100;
    const powers = light.preset === "contrast" ? [4.5, 0.35, 3, 0.45] : light.preset === "rim" ? [1, 0.7, 7, 0.5] : [3, 2, 4, 1.2];
    this.key.intensity = powers[0] * strength;
    this.fill.intensity = powers[1] * strength;
    this.rim.intensity = powers[2] * strength;
    this.ambient.intensity = powers[3] * strength;
    this.scene.environmentIntensity = (light.preset === "soft" ? 1.8 : 0.9) * strength;
    this.lightRig.rotation.y = THREE.MathUtils.degToRad(light.rotation);
    this.scene.environmentRotation.y = THREE.MathUtils.degToRad(light.rotation);
    this.renderer.toneMappingExposure = light.exposure / 100;
    this.backgroundTexture?.dispose();
    this.backgroundTexture = null;
    if (background.mode === "transparent") this.scene.background = null;
    else if (background.mode === "solid") this.scene.background = new THREE.Color(background.color);
    else {
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
    if (JSON.stringify([old.light, old.background, old.screen.island, old.screen.reflection]) !== JSON.stringify([next.light, next.background, next.screen.island, next.screen.reflection])) this.applyEnvironment();
    if (old.device !== next.device || old.finish !== next.finish) void this.loadModel();
    else if (old.fold !== next.fold) this.applyFold();
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

  /** Размер текстуры экрана в пикселях: под него снимаются сайты и фреймы Figma. */
  /** Активная область экрана в пикселях холста, без чёрной рамки монитора. */
  get screenSize() {
    const [insetX, insetY] = this.screen?.inset ?? [0, 0];
    return { width: Math.round(this.screenCanvas.width * (1 - insetX * 2)), height: Math.round(this.screenCanvas.height * (1 - insetY * 2)) };
  }

  /** Возвращает экран к пустому состоянию. */
  clearImage() {
    this.imageRequest++;
    this.screenImage = null;
    this.drawScreen();
  }

  async setImage(url: string) {
    const request = ++this.imageRequest;
    const image = new Image();
    image.src = url;
    await image.decode();
    if (request !== this.imageRequest || this.disposed) return;
    this.screenImage = image;
    this.drawScreen();
  }

  private drawScreen() {
    const context = this.screenCanvas.getContext("2d");
    if (!context) return;
    const { fit, scale, x, y } = this.settings.screen;
    const [insetX, insetY] = this.screen?.inset ?? [0, 0];
    const left = this.screenCanvas.width * insetX, top = this.screenCanvas.height * insetY;
    const width = this.screenCanvas.width - left * 2, height = this.screenCanvas.height - top * 2;
    const image = this.screenImage;
    context.fillStyle = "#080909";
    context.fillRect(0, 0, this.screenCanvas.width, this.screenCanvas.height);
    if (image) {
      const ratio = (fit === "cover" ? Math.max(width / image.naturalWidth, height / image.naturalHeight) : Math.min(width / image.naturalWidth, height / image.naturalHeight)) * scale / 100;
      const drawWidth = image.naturalWidth * ratio, drawHeight = image.naturalHeight * ratio;
      // Рамка монитора остаётся чёрной: изображение обрезается по активной области.
      context.save();
      context.beginPath(); context.rect(left, top, width, height); context.clip();
      context.drawImage(image, left + (width - drawWidth) / 2 + x / 100 * width, top + (height - drawHeight) / 2 + y / 100 * height, drawWidth, drawHeight);
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
    return { mesh, aspect: frame.width / frame.height, inset: config.inset ?? [0, 0], cutout, patch };
  }

  /** Ставит шарнир Duo, выбирает активный экран и заново центрирует модель. */
  private applyFold() {
    const model = deviceModel(this.settings.device);
    if (!this.model || !this.normalized) return;
    const pose = model.fold?.poses[this.settings.fold];
    if (this.mixer && pose) this.mixer.setTime(pose.time);
    this.normalized.rotation.y = THREE.MathUtils.degToRad(pose?.yaw ?? 0);
    const next = this.screens.get(activeScreen(this.settings.device, this.settings.fold).mesh) ?? null;
    this.screens.forEach((slot) => { slot.mesh.material = slot === next ? this.screenMaterial : this.offMaterial; });
    if (next && next !== this.screen) {
      // Телефон — в родной ширине Pro Max, 1290 px: в неё же снимается сайт по
      // ссылке. Горизонтальный экран ноутбука и монитора — 2796 px в ширину.
      const width = next.aspect >= 1 ? 2796 : 1290;
      this.screenCanvas.width = width;
      this.screenCanvas.height = Math.round(width / next.aspect);
      // Размер холста поменялся: старое хранилище текстуры на GPU уже не подходит.
      this.screenTexture.dispose();
    }
    this.screen = next;
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
    parent?.add(this.model);
    this.drawScreen();
    this.applyEnvironment();
  }

  private async loadModel() {
    const request = ++this.modelRequest;
    const model = deviceModel(this.settings.device);
    this.callbacks.model({ status: "loading" });
    try {
      const loader = new GLTFLoader().register((parser) => new SpecularGlossinessPlugin(parser));
      const gltf = await loader.loadAsync(deviceFinish(model.id, this.settings.finish).path);
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
      root.rotation.y += model.rotateY;
      root.updateMatrixWorld(true);
      // Телефон вписывается по высоте, монитор — по ширине: иначе широкая
      // модель вылезает за кадр 4:3 в студийном ракурсе. Глубина ограничивает ноутбук: в
      // перспективе передний край клавиатуры иначе подъезжает к камере.
      const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
      const scale = Math.min(2 / size.y, 2.3 / size.x, 1.9 / size.z);
      const normalized = new THREE.Group();
      normalized.add(root); normalized.scale.setScalar(scale);
      const replacement = new THREE.Group();
      replacement.add(normalized);
      replacement.updateMatrixWorld(true);
      const reflectionMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.15, transparent: true, opacity: this.settings.screen.reflection / 100, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const screens = new Map<string, ScreenSlot>();
      try {
        for (const config of model.fold ? [model.screen, model.fold.outer] : [model.screen]) screens.set(config.mesh, this.buildScreen(root, config, reflectionMaterial));
      } catch (error) { disposeObject(replacement); reflectionMaterial.dispose(); throw error; }
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
      this.screens = screens;
      this.screen = null;
      this.reflectionMaterial = reflectionMaterial;
      this.device.add(replacement);
      this.applyFold();
      this.needsRender = true;
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
      this.renderer.render(this.scene, this.camera);
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

  dispose() {
    this.disposed = true;
    this.modelRequest++; this.imageRequest++;
    cancelAnimationFrame(this.frame); cancelAnimationFrame(this.publishFrame);
    this.observer.disconnect();
    this.controls.dispose();
    this.renderer.domElement.removeEventListener("webglcontextlost", this.handleContextLost);
    if (this.model) disposeObject(this.model);
    this.screenMaterial.dispose(); this.offMaterial.dispose(); this.screenTexture.dispose();
    this.backgroundTexture?.dispose(); this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
