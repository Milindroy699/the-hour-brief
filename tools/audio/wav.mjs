// Tiny WAV writers (24 kHz, mono, 16-bit PCM) for silence between stories and for offline tests.
const RATE = 24000;
function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(v, i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
export const silenceWav = (seconds) => wav(new Int16Array(Math.round(seconds * RATE)));
export const toneWav = (seconds, freq = 220) => {
  const n = Math.round(seconds * RATE), a = new Int16Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin(2 * Math.PI * freq * i / RATE) * 6000 * Math.min(1, i / 400, (n - i) / 400));
  return wav(a);
};
