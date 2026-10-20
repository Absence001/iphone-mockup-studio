import * as THREE from "three";
import { FullScreenQuad } from "three/addons/postprocessing/Pass.js";

/** Разрешение маски тени. Тень мягкая, большего не нужно. */
const SIZE = 512;
/**
 * Отклонение света от оси камеры по длине тени: от 8° — тень почти под
 * устройством — до 65° — длинная тень вбок. Длина 0,35 даёт прежние 28°.
 */
const tilt = (length: number) => Math.tan(THREE.MathUtils.degToRad(8 + length * 57));

export interface ShadowOptions {
  /** Все величины в долях единицы, как ползунки в панели. */
  opacity: number;
  softness: number;
  distance: number;
  length: number;
  color: THREE.Color;
  /** Направление на главный софтбокс в мировых координатах. */
  from: THREE.Vector3;
}

const blurShader = {
  uniforms: { map: { value: null as THREE.Texture | null }, direction: { value: new THREE.Vector2() } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  // Гаусс на девять отсчётов; несколько проходов с убывающим шагом сглаживают ступеньки.
  fragmentShader: `
    uniform sampler2D map; uniform vec2 direction; varying vec2 vUv;
    float tap(float offset) { return texture2D(map, vUv + direction * offset).r + texture2D(map, vUv - direction * offset).r; }
    void main() {
      float sum = texture2D(map, vUv).r * 0.2042 + tap(1.0) * 0.1802 + tap(2.0) * 0.1238 + tap(3.0) * 0.0663 + tap(4.0) * 0.0276;
      gl_FragColor = vec4(vec3(sum), 1.0);
    }`,
};

/**
 * Тень на фоне. У устройства нет пола: камера смотрит и снизу, и сверху, а
 * крен кладёт телефон набок. Поэтому тень падает на невидимую плоскость позади
 * устройства, развёрнутую к камере. Силуэт снимается со стороны света, мягчится
 * и проецируется на плоскость. Плоскость прозрачна везде, кроме самой тени,
 * поэтому тень остаётся и на прозрачном фоне в PNG.
 */
export class BackdropShadow {
  readonly plane: THREE.Mesh;
  private readonly camera = new THREE.OrthographicCamera();
  private readonly targets = [0, 1].map(() => new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: true }));
  private readonly mask = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private readonly blur = new THREE.ShaderMaterial({ ...blurShader, uniforms: THREE.UniformsUtils.clone(blurShader.uniforms), depthTest: false, depthWrite: false });
  private readonly quad = new FullScreenQuad(this.blur);
  private readonly material: THREE.ShaderMaterial;
  private readonly corner = new THREE.Vector3();
  private readonly world = new THREE.Box3();
  private readonly sphere = new THREE.Sphere();
  private readonly clear = new THREE.Color();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: this.targets[0].texture }, matrix: { value: new THREE.Matrix4() }, color: { value: new THREE.Color() }, opacity: { value: 0 } },
      vertexShader: "uniform mat4 matrix; varying vec4 vShadow; void main() { vec4 world = modelMatrix * vec4(position, 1.0); vShadow = matrix * world; gl_Position = projectionMatrix * viewMatrix * world; }",
      fragmentShader: `
        uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec4 vShadow;
        void main() {
          vec2 uv = vShadow.xy / vShadow.w * 0.5 + 0.5;
          vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
          gl_FragColor = vec4(color, texture2D(map, uv).r * inside.x * inside.y * opacity);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    // Плоскость заведомо больше кадра при любом сдвиге и масштабе камеры.
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), this.material);
    this.plane.renderOrder = -1;
    this.plane.frustumCulled = false;
    this.plane.visible = false;
  }

  /**
   * Перестраивает тень под текущий кадр. Свет привязан к камере, поэтому тень
   * пересчитывается при каждом повороте: на фоне она всегда лежит с той
   * стороны, куда указывает главный софтбокс.
   */
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene, device: THREE.Object3D, bounds: THREE.Box3 | null, view: THREE.Camera, options: ShadowOptions | null) {
    this.plane.visible = Boolean(bounds && options);
    if (!bounds || !options) return;
    // Свет в координатах камеры: со стороны софтбокса и немного от зрителя.
    const local = options.from.clone().applyQuaternion(view.quaternion.clone().invert());
    let x = local.x, y = local.y;
    if (Math.hypot(x, y) < 0.15) { x = -0.45; y = 0.9; }
    const length = Math.hypot(x, y);
    const slope = tilt(options.length);
    const toLight = new THREE.Vector3(x / length * slope, y / length * slope, 1).normalize().applyQuaternion(view.quaternion);
    // Плоскость стоит за самой дальней от камеры точкой устройства. Габарит
    // считается в координатах сцены: устройство бывает сдвинуто и увеличено.
    const forward = view.getWorldDirection(new THREE.Vector3());
    let behind = -Infinity;
    device.updateMatrixWorld(true);
    this.world.makeEmpty();
    for (let index = 0; index < 8; index++) {
      this.corner.set(index & 1 ? bounds.max.x : bounds.min.x, index & 2 ? bounds.max.y : bounds.min.y, index & 4 ? bounds.max.z : bounds.min.z).applyMatrix4(device.matrixWorld);
      this.world.expandByPoint(this.corner);
      behind = Math.max(behind, this.corner.dot(forward));
    }
    const gap = 0.08 + options.distance * 1.6;
    this.plane.position.copy(forward).multiplyScalar(behind + gap);
    this.plane.quaternion.copy(view.quaternion);
    // Чем дальше фон и крупнее источник, тем шире полутень.
    const { radius, center } = this.world.getBoundingSphere(this.sphere);
    const spread = 0.02 + options.softness * 0.18 + gap * (0.12 + options.softness * 0.45);
    const half = radius + spread * 2 + 0.05;
    Object.assign(this.camera, { left: -half, right: half, top: half, bottom: -half, near: 0.5, far: radius * 2 + 3.5 });
    this.camera.position.copy(toLight).multiplyScalar(radius + 2).add(center);
    this.camera.up.set(0, 1, 0).applyQuaternion(view.quaternion);
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
    this.material.uniforms.matrix.value.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.material.uniforms.color.value.copy(options.color);
    this.material.uniforms.opacity.value = options.opacity;
    // Силуэт: всё устройство белым на чёрном, без фона и самой плоскости.
    const previous = { target: renderer.getRenderTarget(), alpha: renderer.getClearAlpha(), background: scene.background, override: scene.overrideMaterial };
    renderer.getClearColor(this.clear);
    scene.background = null;
    scene.overrideMaterial = this.mask;
    this.plane.visible = false;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.targets[0]);
    renderer.render(scene, this.camera);
    scene.background = previous.background;
    scene.overrideMaterial = previous.override;
    this.plane.visible = true;
    const texels = Math.min(spread / (half * 2 / SIZE), 96);
    for (const scale of [1 / 4, 1 / 8, 1 / 16]) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const [source, target] = dx ? this.targets : [this.targets[1], this.targets[0]];
        this.blur.uniforms.map.value = source.texture;
        this.blur.uniforms.direction.value.set(dx, dy).multiplyScalar(texels * scale / SIZE);
        renderer.setRenderTarget(target);
        this.quad.render(renderer);
      }
    }
    renderer.setRenderTarget(previous.target);
    renderer.setClearColor(this.clear, previous.alpha);
  }

  dispose() {
    this.targets.forEach((target) => target.dispose());
    this.mask.dispose(); this.blur.dispose(); this.material.dispose(); this.quad.dispose();
    this.plane.geometry.dispose();
  }
}
