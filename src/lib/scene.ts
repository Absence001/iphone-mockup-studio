import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { modelConfig } from "./models";
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

function mapScreenUV(mesh: THREE.Mesh, bounds: THREE.Box3) {
  mesh.updateWorldMatrix(true, false);
  mesh.geometry = mesh.geometry.clone();
  const positions = mesh.geometry.getAttribute("position");
  const uvs = new Float32Array(positions.count * 2);
  const size = bounds.getSize(new THREE.Vector3());
  const point = new THREE.Vector3();
  for (let index = 0; index < positions.count; index++) {
    point.fromBufferAttribute(positions, index).applyMatrix4(mesh.matrixWorld);
    uvs[index * 2] = (point.x - bounds.min.x) / size.x;
    uvs[index * 2 + 1] = (point.y - bounds.min.y) / size.y;
  }
  mesh.geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
}

export class StudioScene {
  readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly perspective = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  private readonly orthographic = new THREE.OrthographicCamera(-2, 2, 1.5, -1.5, 0.01, 100);
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = this.perspective;
  private readonly phone = new THREE.Group();
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
  private reflectionMaterial: THREE.MeshPhysicalMaterial | null = null;
  private backgroundTexture: THREE.CanvasTexture | null = null;
  private screenAspect = 1290 / 2796;
  private screenImage: HTMLImageElement | null = null;
  private hiddenIsland: THREE.Object3D[] = [];
  private islandPatch: THREE.Mesh | null = null;
  private model: THREE.Group | null = null;
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
    this.renderer.domElement.setAttribute("aria-label", "3D-превью телефона. Перетаскивайте для вращения, удерживайте Space для перемещения рабочей области.");
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.addEventListener("webglcontextlost", this.handleContextLost);
    this.host.appendChild(this.renderer.domElement);
    const room = new RoomEnvironment();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.environment = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.environment.texture;
    room.dispose();
    pmrem.dispose();
    this.scene.add(this.phone);
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
    this.phone.rotation.z = THREE.MathUtils.degToRad(roll);
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
    this.hiddenIsland.forEach((object) => { object.visible = screen.island; });
    if (this.islandPatch) this.islandPatch.visible = !screen.island;
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
  get screenSize() {
    return { width: this.screenCanvas.width, height: this.screenCanvas.height };
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
    const width = this.screenCanvas.width, height = this.screenCanvas.height;
    const image = this.screenImage;
    context.fillStyle = "#080909";
    context.fillRect(0, 0, width, height);
    if (image) {
      const ratio = (fit === "cover" ? Math.max(width / image.naturalWidth, height / image.naturalHeight) : Math.min(width / image.naturalWidth, height / image.naturalHeight)) * scale / 100;
      const drawWidth = image.naturalWidth * ratio, drawHeight = image.naturalHeight * ratio;
      context.drawImage(image, (width - drawWidth) / 2 + x / 100 * width, (height - drawHeight) / 2 + y / 100 * height, drawWidth, drawHeight);
    }
    this.screenTexture.needsUpdate = true;
    this.needsRender = true;
  }

  private async loadModel() {
    const request = ++this.modelRequest;
    const config = modelConfig(this.settings.device, this.settings.finish);
    this.callbacks.model({ status: "loading" });
    try {
      const gltf = await new GLTFLoader().loadAsync(config.path);
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
      root.rotation.y += config.rotateY;
      root.updateMatrixWorld(true);
      const sourceBounds = new THREE.Box3().setFromObject(root);
      const scale = 2 / sourceBounds.getSize(new THREE.Vector3()).y;
      root.position.sub(sourceBounds.getCenter(new THREE.Vector3()));
      const normalized = new THREE.Group();
      normalized.add(root); normalized.scale.setScalar(scale); normalized.updateMatrixWorld(true);
      let display: THREE.Mesh | undefined;
      root.traverse((object) => { if (object instanceof THREE.Mesh && object.name === config.screen) display = object; });
      if (!display) { disposeObject(normalized); throw new Error("В модели не найдена поверхность экрана."); }
      const sourceScreen: THREE.Mesh = display;
      const screenBounds = new THREE.Box3().setFromObject(sourceScreen);
      const screenSize = screenBounds.getSize(new THREE.Vector3());
      this.screenAspect = screenSize.x / screenSize.y;
      this.screenCanvas.width = 1290;
      this.screenCanvas.height = Math.round(1290 / this.screenAspect);
      mapScreenUV(sourceScreen, screenBounds);
      const oldMaterial = sourceScreen.material;
      sourceScreen.material = this.screenMaterial;
      for (const material of Array.isArray(oldMaterial) ? oldMaterial : [oldMaterial]) {
        for (const texture of Object.values(material)) if (texture instanceof THREE.Texture) texture.dispose();
        material.dispose();
      }
      const replacement = new THREE.Group();
      replacement.add(normalized);
      const hidden: THREE.Object3D[] = [];
      root.traverse((object) => { if (config.hide.includes(object.name)) hidden.push(object); });
      const islandBounds = new THREE.Box3();
      hidden.forEach((object) => islandBounds.union(new THREE.Box3().setFromObject(object)));
      const islandSize = islandBounds.getSize(new THREE.Vector3());
      const islandCenter = islandBounds.getCenter(new THREE.Vector3());
      const patch = new THREE.Mesh(new THREE.ShapeGeometry(roundedShape(islandSize.x + 0.001, islandSize.y + 0.001, islandSize.y / 2), 32), this.screenMaterial);
      patch.position.set(islandCenter.x, islandCenter.y, screenBounds.max.z + 0.00004);
      replacement.add(patch);
      replacement.updateMatrixWorld(true);
      mapScreenUV(patch, screenBounds);
      const reflectionMaterial = new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0.15, roughness: 0.15, transparent: true, opacity: this.settings.screen.reflection / 100, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      const reflection = new THREE.Mesh(sourceScreen.geometry, reflectionMaterial);
      sourceScreen.updateWorldMatrix(true, false);
      reflection.applyMatrix4(sourceScreen.matrixWorld);
      replacement.add(reflection);
      if (this.model) {
        this.phone.remove(this.model);
        // Материал экрана общий для всех моделей; освобождаем только ресурсы старой модели.
        this.model.traverse((object) => { if (object instanceof THREE.Mesh && object.material === this.screenMaterial) object.material = new THREE.MeshBasicMaterial(); });
        disposeObject(this.model);
      }
      this.model = replacement;
      this.hiddenIsland = hidden;
      this.islandPatch = patch;
      this.reflectionMaterial = reflectionMaterial;
      this.phone.add(replacement);
      this.drawScreen();
      this.applyEnvironment();
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
    this.screenMaterial.dispose(); this.screenTexture.dispose();
    this.backgroundTexture?.dispose(); this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
