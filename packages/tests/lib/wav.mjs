const readString = (view, offset, length) => {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += String.fromCharCode(view.getUint8(offset + i));
  }
  return out;
};

const parseWav = (arrayBuffer) => {
  const view = new DataView(arrayBuffer);
  if (readString(view, 0, 4) !== "RIFF" || readString(view, 8, 4) !== "WAVE") {
    throw new Error("Invalid WAV header (missing RIFF/WAVE).");
  }

  let offset = 12;
  let fmt = null;
  let data = null;

  while (offset + 8 <= view.byteLength) {
    const chunkId = readString(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: view.getUint16(chunkStart, true),
        numChannels: view.getUint16(chunkStart + 2, true),
        sampleRate: view.getUint32(chunkStart + 4, true),
        byteRate: view.getUint32(chunkStart + 8, true),
        blockAlign: view.getUint16(chunkStart + 12, true),
        bitsPerSample: view.getUint16(chunkStart + 14, true)
      };
    } else if (chunkId === "data") {
      data = {
        dataOffset: chunkStart,
        dataSize: chunkSize
      };
    }

    offset = chunkStart + chunkSize;
    if (offset % 2 === 1) offset += 1;
  }

  if (!fmt) throw new Error("WAV missing fmt chunk.");
  if (!data) throw new Error("WAV missing data chunk.");

  const durationSec = fmt.byteRate ? data.dataSize / fmt.byteRate : 0;

  return {
    ...fmt,
    ...data,
    durationSec
  };
};

export {
  parseWav
};
