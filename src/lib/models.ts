import type { Device, Finish } from "./settings";

export const DEVICES: { id: Device; name: string; short: string }[] = [
  { id: "iphone15", name: "iPhone 15 Pro Max", short: "15 Pro Max" },
  { id: "iphone18", name: "iPhone 18 Pro Max", short: "18 Pro Max" },
];

export const FINISHES: { id: Finish; name: string; color: string }[] = [
  { id: "black", name: "Black", color: "#38393b" },
  { id: "glacier", name: "Glacier", color: "#afc9d6" },
  { id: "burgundy", name: "Burgundy", color: "#63303e" },
  { id: "silver", name: "Silver", color: "#d0d1d2" },
];

export function modelConfig(device: Device, finish: Finish) {
  return device === "iphone15" ? {
    path: "/models/iphone.glb", screen: "xXDHkMplTIDAXLN", rotateY: Math.PI,
    hide: ["DjdhycfQYjKMDyn", "usFLmqcyrnltBUr", "SysBlPspVQNIcce", "IMPDFDiRXhPIUMV", "EbQGKrWAqhBHiMv", "EddVrWkqZTlvmci", "aGrbyjnzqoVJenz", "KSWlaxBcnPDpFCs", "AQkWXGdRSkSZMav"],
  } : {
    path: finish === "black" ? "/models/iphone18.glb" : `/models/iphone18-${finish}.glb`,
    screen: "Object_60", rotateY: 0,
    hide: ["Object_4", "Object_10", "Object_66", "Object_80", "Object_82"],
  };
}
