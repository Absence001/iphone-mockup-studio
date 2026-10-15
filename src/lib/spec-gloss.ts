import * as THREE from "three";
import type { GLTFLoaderPlugin, GLTFParser } from "three/addons/loaders/GLTFLoader.js";

const NAME = "KHR_materials_pbrSpecularGlossiness";
const DIELECTRIC = 0.04;

type Factor = [number, number, number, number?];
interface SpecGloss {
  diffuseFactor?: Factor;
  diffuseTexture?: { index: number; texCoord?: number };
  specularFactor?: Factor;
  glossinessFactor?: number;
}

function brightness([r, g, b]: Factor) {
  return Math.sqrt(0.299 * r * r + 0.587 * g * g + 0.114 * b * b);
}

/** Металличность по формуле конвертера Khronos из спецификации glTF. */
function solveMetallic(diffuse: number, specular: number, oneMinusSpecular: number) {
  if (specular < DIELECTRIC) return 0;
  const b = diffuse * oneMinusSpecular / (1 - DIELECTRIC) + specular - 2 * DIELECTRIC;
  const c = DIELECTRIC - specular;
  return THREE.MathUtils.clamp((-b + Math.sqrt(b * b - 4 * DIELECTRIC * c)) / (2 * DIELECTRIC), 0, 1);
}

/**
 * three.js больше не читает KHR_materials_pbrSpecularGlossiness: без этого
 * плагина такие материалы приходят белым металлом. Плагин переводит их в
 * metallic-roughness при загрузке, исходный файл не меняется.
 */
export class SpecularGlossinessPlugin implements GLTFLoaderPlugin {
  readonly name = NAME;
  constructor(private readonly parser: GLTFParser) {}

  extendMaterialParams(materialIndex: number, params: Record<string, unknown>) {
    const extension = this.parser.json.materials[materialIndex].extensions?.[NAME] as SpecGloss | undefined;
    if (!extension) return Promise.resolve();
    const diffuse: Factor = extension.diffuseFactor ?? [1, 1, 1, 1];
    const specular: Factor = extension.specularFactor ?? [1, 1, 1];
    const oneMinusSpecular = 1 - Math.max(specular[0], specular[1], specular[2]);
    // Цвет остаётся диффузным. По точной формуле цвет металла берётся из
    // блика, и при студийном свете тёмная рамка и стекло превращаются в
    // светлый хром. С диффузным цветом рамка остаётся тёмным металлом, как в
    // исходнике.
    params.color = new THREE.Color().setRGB(diffuse[0], diffuse[1], diffuse[2], THREE.LinearSRGBColorSpace);
    params.opacity = diffuse[3] ?? 1;
    params.metalness = solveMetallic(brightness(diffuse), brightness(specular), oneMinusSpecular);
    params.roughness = 1 - (extension.glossinessFactor ?? 1);
    return extension.diffuseTexture ? this.parser.assignTexture(params, "map", extension.diffuseTexture, THREE.SRGBColorSpace) : Promise.resolve();
  }
}
