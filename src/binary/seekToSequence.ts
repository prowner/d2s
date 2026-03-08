import { BitReader } from "./bitreader";

export function seekToSequence(reader: BitReader, sequence: string, offset: number) {
  const bitStr = reader.bits.join("");
  const searchStart = reader.offset;
  const idx = bitStr.indexOf(sequence, searchStart);
  if (idx !== -1) {
    reader.SeekBit(idx + 1 + offset);
  }
}

