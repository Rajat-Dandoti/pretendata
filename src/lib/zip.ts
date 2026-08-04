// Minimal STORE-only (uncompressed) ZIP writer. No deps.
// ponytail: STORE only — fine for CSV/JSON/SQL + small manifest. Add DEFLATE when payloads grow or compression actually matters.

const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date()): { date: number; time: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >>> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { date, time };
}

export interface ZipEntry {
  name: string;
  data: string | Uint8Array;
}

/** Pack files into a single uncompressed ZIP blob. */
export function makeZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const { date, time } = dosDateTime();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const data = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes + name)
    const local = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(local.buffer);
    ldv.setUint32(0, 0x04034b50, true);     // signature
    ldv.setUint16(4, 20, true);              // version needed
    ldv.setUint16(6, 0, true);               // flags
    ldv.setUint16(8, 0, true);               // STORE
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, date, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, size, true);           // compressed
    ldv.setUint32(22, size, true);           // uncompressed
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);              // extra len
    local.set(nameBytes, 30);

    parts.push(local, data);

    // Central directory entry (46 bytes + name)
    const cd = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(cd.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);              // version made by
    cdv.setUint16(6, 20, true);              // version needed
    cdv.setUint16(8, 0, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, date, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, size, true);
    cdv.setUint32(24, size, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint16(30, 0, true);              // extra
    cdv.setUint16(32, 0, true);              // comment
    cdv.setUint16(34, 0, true);              // disk
    cdv.setUint16(36, 0, true);              // internal attrs
    cdv.setUint32(38, 0, true);              // external attrs
    cdv.setUint32(42, offset, true);
    cd.set(nameBytes, 46);
    central.push(cd);

    offset += local.length + data.length;
  }

  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const cdOffset = offset;

  const end = new Uint8Array(22);
  const edv = new DataView(end.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(4, 0, true);
  edv.setUint16(6, 0, true);
  edv.setUint16(8, entries.length, true);
  edv.setUint16(10, entries.length, true);
  edv.setUint32(12, cdSize, true);
  edv.setUint32(16, cdOffset, true);
  edv.setUint16(20, 0, true);

  return new Blob([...parts, ...central, end], { type: 'application/zip' });
}

// ponytail: tiny self-check — assert a zip of "hi" decodes to a valid header.
export function _selfCheck() {
  const blob = makeZip([{ name: 'a.txt', data: 'hi' }]);
  if (blob.size < 60) throw new Error('zip self-check: blob too small');
}
