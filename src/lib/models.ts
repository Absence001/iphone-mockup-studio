import type { Device, Finish, Fold } from "./settings";

export type DeviceKind = "phone" | "foldable" | "laptop" | "display";

export interface ScreenConfig {
  /** Имя меша экрана в GLB. */
  mesh: string;
  /** Детали выреза камеры, которые скрываются вместе с переключателем. */
  cutout: string[];
  /** Пропорция экрана, ширина / высота. */
  aspect: number;
  /** Экран в файле развёрнут обратной стороной: картинку нужно отразить. */
  mirror?: boolean;
  /** Чёрная рамка под стеклом в долях меша по горизонтали и вертикали. */
  inset?: [number, number];
}

export interface DeviceModel {
  id: Device;
  name: string;
  group: string;
  kind: DeviceKind;
  /** Сантиметров в единице сцены: модель нормализуется по габаритам. */
  unit: number;
  rotateY: number;
  finishes: { id: Finish; name: string; color: string; path: string }[];
  screen: ScreenConfig;
  /** Складной телефон: внешний экран и анимация шарнира из файла. */
  fold?: { clip: string; poses: Record<Fold, { time: number; yaw: number }>; outer: ScreenConfig };
}

const IPHONE18_ISLAND = ["Object_4", "Object_10", "Object_66", "Object_80", "Object_82"];

export const DEVICES: DeviceModel[] = [
  {
    id: "iphone15", name: "iPhone 15 Pro Max", group: "iPhone", kind: "phone", unit: 7.98, rotateY: Math.PI,
    finishes: [{ id: "black", name: "Black", color: "#38393b", path: "/models/iphone.glb" }],
    screen: { mesh: "xXDHkMplTIDAXLN", aspect: 1290 / 2796, cutout: ["DjdhycfQYjKMDyn", "usFLmqcyrnltBUr", "SysBlPspVQNIcce", "IMPDFDiRXhPIUMV", "EbQGKrWAqhBHiMv", "EddVrWkqZTlvmci", "aGrbyjnzqoVJenz", "KSWlaxBcnPDpFCs", "AQkWXGdRSkSZMav"] },
  },
  {
    id: "iphone18", name: "iPhone 18 Pro Max", group: "iPhone", kind: "phone", unit: 8.16, rotateY: 0,
    finishes: [
      { id: "black", name: "Black", color: "#38393b", path: "/models/iphone18.glb" },
      { id: "glacier", name: "Glacier", color: "#afc9d6", path: "/models/iphone18-glacier.glb" },
      { id: "burgundy", name: "Burgundy", color: "#63303e", path: "/models/iphone18-burgundy.glb" },
      { id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/iphone18-silver.glb" },
    ],
    screen: { mesh: "Object_60", aspect: 1290 / 2796, cutout: IPHONE18_ISLAND },
  },
  {
    id: "iphoneDuo", name: "iPhone Duo", group: "iPhone", kind: "foldable", unit: 7.22, rotateY: 0,
    finishes: [{ id: "starWhite", name: "Star White", color: "#e7e4dd", path: "/models/iphone-duo-star-white.glb" }],
    screen: { mesh: "Object_106", aspect: 0.159 / 0.111, cutout: [] },
    // Клип в файле идёт от раскрытого состояния (0 с) к сложенному (2 с) и
    // поворачивает только левую половину. «Книжкой» половины расходятся
    // примерно на 110°; поворот всей модели на половину сгиба ставит их
    // симметрично к камере.
    fold: {
      clip: "open-close", poses: { open: { time: 0, yaw: 0 }, book: { time: 0.85, yaw: -35 }, closed: { time: 2, yaw: 0 } },
      outer: { mesh: "Object_72", aspect: 0.078 / 0.112, cutout: ["Object_76", "Object_78", "Object_80", "Object_82"] },
    },
  },
  {
    id: "galaxyS26Ultra", name: "Galaxy S26 Ultra", group: "Android", kind: "phone", unit: 8.15, rotateY: 0,
    finishes: [{ id: "violet", name: "Violet", color: "#a9a3e2", path: "/models/galaxy-s26-ultra.glb" }],
    screen: { mesh: "Object_35", aspect: 0.073 / 0.158, cutout: ["Object_29", "Object_32", "Object_38"] },
  },
  {
    id: "macbookPro14", name: "MacBook Pro 14″", group: "Mac", kind: "laptop", unit: 15.8, rotateY: 0,
    finishes: [{ id: "spaceBlack", name: "Space Black", color: "#2e2e30", path: "/models/macbook-pro-14.glb" }],
    screen: { mesh: "Object_107", aspect: 3024 / 1964, cutout: [] },
  },
  {
    id: "proDisplayXdr", name: "Pro Display XDR", group: "Дисплеи", kind: "display", unit: 31.3, rotateY: 0,
    finishes: [{ id: "silver", name: "Silver", color: "#d0d1d2", path: "/models/pro-display-xdr.glb" }],
    // Меш экрана — всё стекло 720 × 411 мм, активная область 703 × 395 мм.
    screen: { mesh: "IyklIWCEUuwKzOr", aspect: 6016 / 3384, cutout: [], mirror: true, inset: [0.012, 0.02] },
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

/** Экран, на который выводится изображение: у сложенного Duo — внешний. */
export function activeScreen(device: Device, fold: Fold): ScreenConfig {
  const model = deviceModel(device);
  return model.fold && fold === "closed" ? model.fold.outer : model.screen;
}
