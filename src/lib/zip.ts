/**
 * ZIP без сжатия для последовательности PNG. PNG уже сжат, поэтому
 * упаковка «как есть» почти не проигрывает в размере и не требует
 * библиотеки. Формат — локальные заголовки, данные и центральный каталог.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index++) {
    let value = index;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < bytes.length; index++) crc = TABLE[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry { name: Uint8Array<ArrayBuffer>; crc: number; size: number; offset: number }

export class ZipWriter {
  private readonly parts: BlobPart[] = [];
  private readonly entries: Entry[] = [];
  private offset = 0;

  async add(name: string, blob: Blob) {
    const data = new Uint8Array(await blob.arrayBuffer());
    const encoded = new TextEncoder().encode(name);
    const header = new DataView(new ArrayBuffer(30));
    const crc = crc32(data);
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    // Бит 11: имена в UTF-8.
    header.setUint16(6, 0x0800, true);
    header.setUint16(8, 0, true);
    header.setUint16(10, 0, true);
    header.setUint16(12, 0x21, true);
    header.setUint32(14, crc, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, encoded.length, true);
    header.setUint16(28, 0, true);
    // Сам кадр кладётся исходным Blob: браузер может держать его не в памяти страницы.
    this.parts.push(header.buffer, encoded, blob);
    this.entries.push({ name: encoded, crc, size: data.length, offset: this.offset });
    this.offset += 30 + encoded.length + data.length;
  }

  finish(): Blob {
    const start = this.offset;
    let length = 0;
    for (const entry of this.entries) {
      const record = new DataView(new ArrayBuffer(46));
      record.setUint32(0, 0x02014b50, true);
      record.setUint16(4, 20, true);
      record.setUint16(6, 20, true);
      record.setUint16(8, 0x0800, true);
      record.setUint16(10, 0, true);
      record.setUint16(12, 0, true);
      record.setUint16(14, 0x21, true);
      record.setUint32(16, entry.crc, true);
      record.setUint32(20, entry.size, true);
      record.setUint32(24, entry.size, true);
      record.setUint16(28, entry.name.length, true);
      record.setUint32(42, entry.offset, true);
      this.parts.push(record.buffer, entry.name);
      length += 46 + entry.name.length;
    }
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, this.entries.length, true);
    end.setUint16(10, this.entries.length, true);
    end.setUint32(12, length, true);
    end.setUint32(16, start, true);
    this.parts.push(end.buffer);
    return new Blob(this.parts, { type: "application/zip" });
  }
}
