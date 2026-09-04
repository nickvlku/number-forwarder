/** Minimal WAV (RIFF, 16-bit PCM mono) encoder and header reader. Runs in the browser and on the server. */

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/** Encodes float samples in [-1, 1] as 16-bit mono PCM WAV. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  writeAscii(v, 0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // byte rate
  v.setUint16(32, 2, true); // block align
  v.setUint16(34, 16, true); // bits per sample
  writeAscii(v, 36, "data");
  v.setUint32(40, dataBytes, true);
  let o = 44;
  for (const s of samples) {
    const c = Math.max(-1, Math.min(1, s));
    v.setInt16(o, c < 0 ? c * 32768 : c * 32767, true);
    o += 2;
  }
  return buf;
}

export function isWav(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 44) return false;
  const v = new DataView(buf);
  return readAscii(v, 0, 4) === "RIFF" && readAscii(v, 8, 4) === "WAVE" && readAscii(v, 12, 4) === "fmt ";
}

/** Duration in seconds from the header, or null when the bytes are not a PCM WAV we can read. */
export function wavDurationSeconds(buf: ArrayBuffer): number | null {
  if (!isWav(buf)) return null;
  const v = new DataView(buf);
  let offset = 12;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  while (offset + 8 <= buf.byteLength) {
    const id = readAscii(v, offset, 4);
    const size = v.getUint32(offset + 4, true);
    if (id === "fmt ") {
      channels = v.getUint16(offset + 10, true);
      sampleRate = v.getUint32(offset + 12, true);
      bitsPerSample = v.getUint16(offset + 22, true);
    } else if (id === "data") {
      const bytesPerSecond = sampleRate * channels * (bitsPerSample / 8);
      if (!bytesPerSecond) return null;
      const dataBytes = Math.min(size, buf.byteLength - offset - 8);
      return dataBytes / bytesPerSecond;
    }
    offset += 8 + size + (size % 2);
  }
  return null;
}
