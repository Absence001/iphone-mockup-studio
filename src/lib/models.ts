import { FOLD_OUTER_BELOW, type Device, type Finish } from "./settings";

export type DeviceKind = "phone" | "foldable" | "tablet" | "watch" | "laptop" | "display";

export interface ScreenConfig {
  /** Имя меша экрана в GLB. */
  mesh: string;
  /** Детали выреза камеры, которые скрываются вместе с переключателем. */
  cutout: string[];
  /** Пропорция экрана, ширина / высота. */
  aspect: number;
  /** Родное разрешение настоящего устройства: в нём скриншот ляжет на экран без обрезки и полей. */
  pixels?: [number, number];
  /** Экран в файле развёрнут обратной стороной: картинку нужно отразить. */
  mirror?: boolean;
  /** Чёрная рамка под стеклом в долях меша по горизонтали и вертикали. */
  inset?: [number, number];
  /**
   * Ширина текстуры экрана в пикселях. По умолчанию 1290 у вертикального
   * экрана и 2796 у горизонтального; в неё же снимается сайт по ссылке.
   */
  width?: number;
}

export interface DeviceFinish {
  id: Finish;
  name: string;
  color: string;
  path: string;
  /**
   * Файлы одной модели в разных цветах бывают выгружены по-разному: со
   * своими именами узлов экрана и выреза и с другим поворотом.
   */
  screen?: Pick<ScreenConfig, "mesh" | "cutout">;
  /** Поворот файла вокруг оси X в градусах, чтобы экран смотрел в камеру. */
  rotateX?: number;
  /**
   * Цвет, которого нет отдельным файлом: оттенок `from` в материалах и
   * текстурах корпуса перекрашивается в `to` при загрузке.
   */
  recolor?: { from: string; to: string };
}

export interface DeviceModel {
  id: Device;
  name: string;
  group: string;
  kind: DeviceKind;
  /** Сантиметров в единице сцены: модель нормализуется по габаритам. */
  unit: number;
  rotateY: number;
  finishes: DeviceFinish[];
  screen: ScreenConfig;
  /**
   * Складной телефон: анимация шарнира из файла от раскрытого состояния к
   * сложенному и внешний экран.
   */
  fold?: { clip: string; outer: ScreenConfig };
  /**
   * Ноутбук: узел крышки и её раскрытие в файле, в градусах. Ось шарнира идёт
   * по ширине модели от заднего верхнего края корпуса, утопленная на `hinge` —
   * вниз и вперёд в долях толщины корпуса.
   */
  lid?: { node: string; angle: number; hinge: [number, number] };
}

const IPHONE15_ISLAND = ["DjdhycfQYjKMDyn", "usFLmqcyrnltBUr", "SysBlPspVQNIcce", "IMPDFDiRXhPIUMV", "EbQGKrWAqhBHiMv", "EddVrWkqZTlvmci", "aGrbyjnzqoVJenz", "KSWlaxBcnPDpFCs", "AQkWXGdRSkSZMav"];
const IPHONE17_ISLAND = ["Object_7", "Object_23", "Object_27", "Object_35", "Object_39", "Object_63", "Object_73", "Object_151"];
// Deep Blue и Silver — тот же файл Cosmic Orange, перекрашенный при загрузке.
const IPHONE17_FINISHES: DeviceFinish[] = [
  { id: "cosmicOrange", name: "Cosmic Orange", color: "#f0782f", path: "/models/iphone17-cosmic-orange.glb" },
  { id: "deepBlue", name: "Deep Blue", color: "#2b3650", path: "/models/iphone17-cosmic-orange.glb", recolor: { from: "#f0782f", to: "#2b3650" } },
  { id: "silver", name: "Silver", color: "#e1e2e3", path: "/models/iphone17-cosmic-orange.glb", recolor: { from: "#f0782f", to: "#e1e2e3" } },
];
const IPHONE18_ISLAND = ["Object_4", "Object_10", "Object_66", "Object_80", "Object_82"];

export const DEVICES: DeviceModel[] = [
  {
    id: "iphone15Pro", name: "iPhone 15 Pro", group: "iPhone", kind: "phone", unit: 7.32, rotateY: Math.PI,
    finishes: [
      { id: "black", name: "Black Titanium", color: "#38393b", path: "/models/iphone15-pro-black.glb" },
      { id: "white", name: "White Titanium", color: "#e3e2dd", path: "/models/iphone15-pro-white.glb", screen: { mesh: "yDOgDFDtWNeXKAz", cutout: ["GiZuOAiXwpEAlFC", "QGOtavIUblRDlcQ", "VcnzayDGpqmJfRr", "LpvVkYknBmyGYdv", "lXqHKMuKcrTJVbj", "RzeFuTJokTxcUoM", "QKacNnJliPZMgVV", "IOadpFYOOCcfgiU", "gNUvLkUAjoNQHNo"] } },
      { id: "blue", name: "Blue Titanium", color: "#3f4a58", path: "/models/iphone15-pro-blue.glb", screen: { mesh: "MyyMINLGaHxUfRC", cutout: ["swgAQhvTOJjeVkR", "bAYIhcFTidCyHoh", "hreyZOHpCuCVOps", "DCmyPMzDZUbLHOk", "bIGceuHeMOlLlIr", "knrBizMjMWWSrmI", "ffnLHNCjwqoKWLq", "syVGKJkNVkNNtrJ", "YSXlpkhBomhhMVP"] } },
      { id: "natural", name: "Natural Titanium", color: "#bab4a9", path: "/models/iphone15-pro-natural.glb", screen: { mesh: "OPyTWluDoHpcqDg", cutout: ["zBdQdXdsStpRAHX", "CWlDteWPdNAUGEg", "LpLptVfughRqdMN", "ybcUuSdmTVuJELP", "gVGGYDWXreTtKYW", "CKnbbWpLfJTQfks", "mVYeahnqGenDuTX", "zbMQLdHRtIzqQMH", "RpYtxqQloUEXzeP"] } },
    ],
    screen: { mesh: "mLHnukkEtKOkORc", aspect: 1179 / 2556, pixels: [1179, 2556], cutout: ["VaIdITgcvAEswbE", "AwaTTvzfXeXysUh", "zGUfpyhYyXwwIwH", "jnGGkguwjheKNOh", "YhxULnHbuDthdGe", "GrOLxJSnnaGkJfc", "XKBIWBjpFFdQbUy", "fhxaXEhDZvQmEJq", "YQQMWtuDRilWwjr"], width: 1179 },
  },
  {
    id: "iphone15", name: "iPhone 15 Pro Max", group: "iPhone", kind: "phone", unit: 7.98, rotateY: Math.PI,
    // Цвета — отдельные выгрузки той же модели с другими именами узлов;
    // экран и вырез сопоставлены с чёрной по геометрии.
    finishes: [
      { id: "black", name: "Black Titanium", color: "#38393b", path: "/models/iphone.glb" },
      { id: "white", name: "White Titanium", color: "#e3e2dd", path: "/models/iphone15-white.glb", screen: { mesh: "rQQFaEpqNoDTcgi", cutout: ["lMfEugKNJEGMJcB", "HleollVRPKRFEUP", "HJGtBrvvwdIIehw", "hlkjtzNnvwcSOaM", "YPYOoMtbmxLbyLx", "efwZOmFGSvFMCxi", "usedOflaRkfIPLs", "bIQnnECGlmvjHdL", "IdVudomIZoJECEo"] } },
      { id: "blue", name: "Blue Titanium", color: "#3f4a58", path: "/models/iphone15-blue.glb", screen: { mesh: "JZzWGJgQqVfdjSg", cutout: ["kCdiHhYyrYwyxjr", "yaAEaQTIFhNOZxX", "qJXxkMEnatVZfAu", "WgpcHcFipFGJfDt", "TBfShIqmzSkiyOV", "JwvWXOfUeQZlCNl", "RWxnCMWLDlEBvZg", "SpeferDWNPmclPb", "xlcoMKGyFmfEEtu"] } },
      { id: "natural", name: "Natural Titanium", color: "#bab4a9", path: "/models/iphone15-natural.glb", screen: { mesh: "xuumQFYYicplRrq", cutout: ["mZuGFozhZmiNERN", "enWoNOGyEJnFVeJ", "KyqzMbdRAvVmbaQ", "hzVCkRmwJAWNBEr", "jLTGRAqbvvSppoj", "RMzeCckxdJWZyQV", "RpDFQqZUiRJjOVU", "JtvNAWwoBAwsYHV", "bKJgKfAMywmyegn"] } },
    ],
    screen: { mesh: "xXDHkMplTIDAXLN", aspect: 1290 / 2796, pixels: [1290, 2796], cutout: IPHONE15_ISLAND },
  },
  {
    // Корпус 17 Pro повторяет Pro Max в масштабе 0,92 по ширине и высоте:
    // модель та же, отличаются реальный размер и родная ширина экрана.
    id: "iphone17Pro", name: "iPhone 17 Pro", group: "iPhone", kind: "phone", unit: 7.5, rotateY: 0,
    finishes: IPHONE17_FINISHES,
    screen: { mesh: "Object_49", aspect: 1206 / 2622, pixels: [1206, 2622], cutout: IPHONE17_ISLAND, width: 1206 },
  },
  {
    id: "iphone17", name: "iPhone 17 Pro Max", group: "iPhone", kind: "phone", unit: 8.15, rotateY: 0,
    finishes: IPHONE17_FINISHES,
    screen: { mesh: "Object_49", aspect: 1320 / 2868, pixels: [1320, 2868], cutout: IPHONE17_ISLAND },
  },
  {
    id: "iphone18Pro", name: "iPhone 18 Pro", group: "iPhone", kind: "phone", unit: 7.5, rotateY: 0,
    finishes: [
      { id: "black", name: "Black", color: "#38393b", path: "/models/iphone18-pro-black.glb" },
      { id: "glacier", name: "Glacier", color: "#afc9d6", path: "/models/iphone18-pro-glacier.glb" },
      { id: "burgundy", name: "Burgundy", color: "#63303e", path: "/models/iphone18-pro-burgundy.glb" },
      { id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/iphone18-pro-silver.glb" },
    ],
    screen: { mesh: "Object_60", aspect: 1206 / 2622, pixels: [1206, 2622], cutout: IPHONE18_ISLAND, width: 1206 },
  },
  {
    id: "iphone18", name: "iPhone 18 Pro Max", group: "iPhone", kind: "phone", unit: 8.16, rotateY: 0,
    finishes: [
      { id: "black", name: "Black", color: "#38393b", path: "/models/iphone18.glb" },
      { id: "glacier", name: "Glacier", color: "#afc9d6", path: "/models/iphone18-glacier.glb" },
      { id: "burgundy", name: "Burgundy", color: "#63303e", path: "/models/iphone18-burgundy.glb" },
      { id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/iphone18-silver.glb" },
    ],
    screen: { mesh: "Object_60", aspect: 1320 / 2868, pixels: [1320, 2868], cutout: IPHONE18_ISLAND },
  },
  {
    id: "iphoneDuo", name: "iPhone Duo", group: "iPhone", kind: "foldable", unit: 7.22, rotateY: 0,
    finishes: [{ id: "starWhite", name: "Star White", color: "#e7e4dd", path: "/models/iphone-duo-star-white.glb" }],
    screen: { mesh: "Object_106", aspect: 0.159 / 0.111, cutout: [] },
    // Клип в файле идёт от раскрытого состояния (0 с) к сложенному (2 с):
    // два сустава шарнира поворачивают левую половину на 90° каждый.
    fold: {
      clip: "open-close",
      outer: { mesh: "Object_72", aspect: 0.078 / 0.112, cutout: ["Object_76", "Object_78", "Object_80", "Object_82"] },
    },
  },
  {
    id: "galaxyS26Ultra", name: "Galaxy S26 Ultra", group: "Android", kind: "phone", unit: 8.15, rotateY: 0,
    finishes: [{ id: "violet", name: "Violet", color: "#a9a3e2", path: "/models/galaxy-s26-ultra.glb" }],
    screen: { mesh: "Object_35", aspect: 1440 / 3120, pixels: [1440, 3120], cutout: ["Object_29", "Object_32", "Object_38"] },
  },
  {
    id: "ipadPro13", name: "iPad Pro 13″", group: "iPad", kind: "tablet", unit: 16.54, rotateY: 0,
    // Чёрный выгружен лёжа экраном вверх.
    finishes: [
      { id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/ipad-pro-13-silver.glb" },
      { id: "spaceBlack", name: "Space Black", color: "#2e2e30", path: "/models/ipad-pro-13-space-black.glb", screen: { mesh: "Object_42", cutout: [] }, rotateX: 90 },
    ],
    // Родная ширина 2064 px: сайт по ссылке снимается в настольной вёрстке
    // шириной 1032 точки, как в Safari на iPad.
    screen: { mesh: "Object_10", aspect: 2064 / 2752, pixels: [2064, 2752], cutout: [], width: 2064 },
  },
  {
    id: "macbookAir13", name: "MacBook Air 13″", group: "Mac", kind: "laptop", unit: 15.35, rotateY: 0,
    finishes: [{ id: "skyBlue", name: "Sky Blue", color: "#a9c4d6", path: "/models/macbook-air-13-sky-blue.glb" }],
    screen: { mesh: "rDFfyciWhHsbLaX", aspect: 2560 / 1664, pixels: [2560, 1664], cutout: [] },
    lid: { node: "aljtiWupdNemGeL", angle: 110, hinge: [0.35, 0.17] },
  },
  {
    id: "macbookPro14", name: "MacBook Pro 14″", group: "Mac", kind: "laptop", unit: 15.8, rotateY: 0,
    finishes: [{ id: "spaceBlack", name: "Space Black", color: "#2e2e30", path: "/models/macbook-pro-14.glb" }],
    screen: { mesh: "Object_107", aspect: 3024 / 1964, pixels: [3024, 1964], cutout: [] },
    lid: { node: "RcexTyyhpuJYATQ_61", angle: 110, hinge: [0.35, 0.17] },
  },
  {
    id: "imac24", name: "iMac 24″", group: "Mac", kind: "display", unit: 23.86, rotateY: 0,
    finishes: [{ id: "blue", name: "Blue", color: "#5b84c4", path: "/models/imac-24-blue.glb" }],
    screen: { mesh: "VIprOjNCeIeaTGh", aspect: 4480 / 2520, pixels: [4480, 2520], cutout: [] },
  },
  {
    id: "proDisplayXdr", name: "Pro Display XDR", group: "Дисплеи", kind: "display", unit: 31.3, rotateY: 0,
    finishes: [{ id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/pro-display-xdr.glb" }],
    // Меш экрана — всё стекло 720 × 411 мм, активная область 703 × 395 мм.
    screen: { mesh: "IyklIWCEUuwKzOr", aspect: 6016 / 3384, pixels: [6016, 3384], cutout: [], mirror: true, inset: [0.012, 0.02] },
  },
  {
    id: "watchUltra2", name: "Apple Watch Ultra 2", group: "Часы", kind: "watch", unit: 3.81, rotateY: 0,
    // В файле часы наклонены экраном вверх на 35°.
    finishes: [{ id: "natural", name: "Natural Titanium", color: "#bab4a9", path: "/models/watch-ultra-2-natural.glb", rotateX: 35 }],
    screen: { mesh: "VHnHbLOyhEXLvWA", aspect: 410 / 502, pixels: [410, 502], cutout: [] },
  },
  {
    id: "watchSeries9", name: "Apple Watch Series 9", group: "Часы", kind: "watch", unit: 3.56, rotateY: 0,
    finishes: [{ id: "starlight", name: "Starlight", color: "#e3dccf", path: "/models/watch-series-9-starlight.glb", rotateX: 35 }],
    screen: { mesh: "rpqLEPlKpASApqb", aspect: 396 / 484, pixels: [396, 484], cutout: [] },
  },
];

export function deviceModel(device: Device): DeviceModel {
  return DEVICES.find((item) => item.id === device) ?? DEVICES[0];
}

/** Цвет из списка модели; неизвестный цвет заменяется первым доступным. */
export function deviceFinish(device: Device, finish: Finish) {
  const model = deviceModel(device);
  return model.finishes.find((item) => item.id === finish) ?? model.finishes[0];
}

/** Экран, на который выводится изображение: у Duo, сложенного меньше прямого угла, — внешний. */
export function activeScreen(device: Device, fold: number): ScreenConfig {
  const model = deviceModel(device);
  return model.fold && fold < FOLD_OUTER_BELOW ? model.fold.outer : model.screen;
}

/** Экраны модели в файле выбранного цвета: основной и внешний у Duo. */
export function finishScreens(device: Device, finish: Finish): { main: ScreenConfig; outer?: ScreenConfig } {
  const model = deviceModel(device);
  return { main: { ...model.screen, ...deviceFinish(device, finish).screen }, outer: model.fold?.outer };
}
