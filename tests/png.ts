import { deflateSync, inflateSync } from "node:zlib";

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const name = Buffer.from(type), size = Buffer.alloc(4), checksum = Buffer.alloc(4);
  size.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([size, name, data, checksum]);
}

export function testImage(): Buffer {
  const width = 129, height = 279, header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * (width * 4 + 1) + 1 + x * 4;
    const color = y < height / 3 ? [235, 30, 30] : y < height * 2 / 3 ? [30, 60, 220] : [30, 220, 100];
    raw[index] = color[0]; raw[index + 1] = color[1]; raw[index + 2] = color[2]; raw[index + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

export function decodePNG(buffer: Buffer) {
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20), depth = buffer[24], type = buffer[25];
  if (depth !== 8 || ![2, 6].includes(type)) throw new Error(`Неподдерживаемый формат PNG в проверке: ${depth}/${type}`);
  const channels = type === 6 ? 4 : 3;
  const chunks: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset), kind = buffer.subarray(offset + 4, offset + 8).toString();
    if (kind === "IDAT") chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  const data = inflateSync(Buffer.concat(chunks)), stride = width * channels, pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const method = data[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const index = y * stride + x;
      const left = x >= channels ? pixels[index - channels] : 0, up = y > 0 ? pixels[index - stride] : 0, corner = y > 0 && x >= channels ? pixels[index - stride - channels] : 0;
      let prediction = 0;
      if (method === 1) prediction = left;
      else if (method === 2) prediction = up;
      else if (method === 3) prediction = Math.floor((left + up) / 2);
      else if (method === 4) {
        const p = left + up - corner, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
        prediction = a <= b && a <= c ? left : b <= c ? up : corner;
      }
      pixels[index] = (data[y * (stride + 1) + x + 1] + prediction) & 255;
    }
  }
  return {
    width, height, pixels, channels,
    pixel(x: number, y: number) { const index = (Math.floor(y) * width + Math.floor(x)) * channels; return [pixels[index], pixels[index + 1], pixels[index + 2], channels === 4 ? pixels[index + 3] : 255]; },
  };
}
