import { describe, it, expect } from "vitest";
import { encodeWav, isWav, wavDurationSeconds } from "@/lib/wav";

describe("encodeWav", () => {
  it("writes a 16-bit mono PCM RIFF header and the samples", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const buf = encodeWav(samples, 16000);
    const view = new DataView(buf);
    const ascii = (o: number, n: number) => String.fromCharCode(...new Uint8Array(buf, o, n));
    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16383);
    expect(view.getInt16(50, true)).toBe(32767);
    expect(view.getInt16(52, true)).toBe(-32768);
  });

  it("clamps out-of-range samples", () => {
    const view = new DataView(encodeWav(new Float32Array([2, -2]), 8000));
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

describe("isWav and wavDurationSeconds", () => {
  it("recognises its own output and computes the duration", () => {
    const buf = encodeWav(new Float32Array(16000 * 3), 16000);
    expect(isWav(buf)).toBe(true);
    expect(wavDurationSeconds(buf)).toBe(3);
  });
  it("rejects non-wav bytes", () => {
    const junk = new TextEncoder().encode("<svg onload=alert(1)/>").buffer as ArrayBuffer;
    expect(isWav(junk)).toBe(false);
    expect(wavDurationSeconds(junk)).toBeNull();
    expect(isWav(new ArrayBuffer(10))).toBe(false);
  });
});
