import * as types from "./types";
import { BitWriter } from "../binary/bitwriter";
import * as items from "./items";
import { enhanceItems } from "./attribute_enhancer";
import { BitReader } from "../binary/bitreader";
import { config } from "chai";
import { getConstantData } from "./constants";
import { constants as constants_105 } from "../data/versions/105_constant_data";

const defaultConfig = {
  extendedStash: false,
} as types.IConfig;

export async function read(
  buffer: Uint8Array,
  constants?: types.IConstantData,
  version?: number | null,
  userConfig?: types.IConfig
): Promise<types.IStash> {
  const stash = {} as types.IStash;
  const reader = new BitReader(buffer);
  const config = Object.assign(defaultConfig, userConfig);
  const firstHeader = reader.ReadUInt32();
  reader.SeekByte(0);
  if (firstHeader == 0xaa55aa55) {
    stash.pages = [];
    stash.sharedGold = 0;
    let pageCount = 0;
    while (reader.offset < reader.bits.length && pageCount < 6) {
      const pageIndex = pageCount;
      pageCount++;
      await readStashHeader(stash, reader, pageIndex);
      const saveVersion = version || parseInt(stash.version);
      if (!constants) {
        constants = getConstantData(saveVersion);
      }
      await readStashPart(stash, reader, saveVersion, constants, pageIndex);
    }
    const saveVersion = version || parseInt(stash.version);
    if (!constants) {
      constants = getConstantData(saveVersion);
    }
    await readChronicle(stash, reader, saveVersion, constants);
    stash.pageCount = pageCount;
  } else {
    await readStashHeader(stash, reader);
    const saveVersion = version || parseInt(stash.version);
    if (!constants) {
      constants = getConstantData(saveVersion);
    }
    await readStashPages(stash, reader, saveVersion, constants);
  }
  return stash;
}

async function readStashHeader(stash: types.IStash, reader: BitReader, pageIndex?: number) {
  const header = reader.ReadUInt32();
  switch (header) {
    // Resurrected
    case 0xaa55aa55:
      stash.type = types.EStashType.shared;
      stash.hardcore = reader.ReadUInt32() == 0;
      stash.version = reader.ReadUInt32().toString();
      const version = parseInt(stash.version);
      stash.sharedGold += reader.ReadUInt32();
      reader.ReadUInt32(); // size of the sector
      if (version === 0x69 && pageIndex !== undefined) {
        const isStackable = reader.ReadByte();
        stash.pages[pageIndex] = {
          items: [],
          name: "",
          type: 0,
          isStackable,
        };
        reader.SkipBytes(43);
      } else {
        reader.SkipBytes(44); // empty
      }
      break;
    // LoD
    case 0x535353: // SSS
    case 0x4d545343: // CSTM
      stash.version = reader.ReadString(2);
      if (stash.version !== "01" && stash.version !== "02") {
        throw new Error(`unkown stash version ${stash.version} at position ${reader.offset - 2 * 8}`);
      }

      stash.type = header === 0x535353 ? types.EStashType.shared : types.EStashType.private;

      if (stash.type === types.EStashType.shared && stash.version == "02") {
        stash.sharedGold = reader.ReadUInt32();
      }

      if (stash.type === types.EStashType.private) {
        reader.ReadUInt32();
        stash.sharedGold = 0;
      }

      stash.pageCount = reader.ReadUInt32();
      break;
    default:
      debugger;
      throw new Error(
        `shared stash header 'SSS' / 0xAA55AA55 / private stash header 'CSTM' not found at position ${reader.offset - 3 * 8}`
      );
  }
}

async function readStashPages(stash: types.IStash, reader: BitReader, version: number, constants: types.IConstantData) {
  stash.pages = [];
  for (let i = 0; i < stash.pageCount; i++) {
    await readStashPage(stash, reader, version, constants);
  }
}

const CHRONICLE_SECTION_MAGIC = 0xaa55aa55;
const CHRONICLE_MAGIC = 0xc0eaedc0;
const CHRONICLE_VERSION = 1;

const emptyChronicle = (trailing: Uint8Array = new Uint8Array(0)): types.IChronicle => ({
  setItems: [],
  uniqueItems: [],
  runewords: [],
  _unknown_data: {
    envelopePadding: new Uint8Array(44),
    trailing,
    originalCounts: { setItems: 0, uniqueItems: 0, runewords: 0 },
  },
});

async function readChronicle(stash: types.IStash, reader: BitReader, version: number, constants: types.IConstantData) {
  const remainingBytes = (reader.bits.length - reader.offset) / 8;
  // The chronicle section is wrapped in the same 64-byte sector envelope used by regular
  // stash pages (magic, hardcore flag, save version, unused gold slot, size of sector, padding).
  if (remainingBytes < 64 || reader.ReadUInt32() !== CHRONICLE_SECTION_MAGIC) {
    stash.chronicle = emptyChronicle(reader.ReadBytes(Math.max(0, remainingBytes - 4)));
    return;
  }
  reader.ReadUInt32(); // hardcore flag, mirrors the stash header, unused here
  reader.ReadUInt32(); // save version, mirrors stash.version
  reader.ReadUInt32(); // unused (gold slot on regular pages)
  reader.ReadUInt32(); // size of sector
  // Not fully understood (mirrors the isStackable-byte + padding slot on real v0x69 pages); preserved verbatim rather than assumed to be zero.
  const envelopePadding = reader.ReadBytes(44);

  if (reader.ReadUInt32() !== CHRONICLE_MAGIC) {
    stash.chronicle = emptyChronicle();
    return;
  }
  reader.ReadUInt16(); // chronicle format version
  const setCount = reader.ReadUInt16();
  const uniqueCount = reader.ReadUInt16();
  const runewordCount = reader.ReadUInt16();
  reader.SkipBytes(8); // reserved

  const readRawEntries = (count: number) => {
    const entries: { itemId: number; monster: number; foundAt: number }[] = [];
    for (let i = 0; i < count; i++) {
      const itemId = reader.ReadUInt32();
      const monster = reader.ReadUInt16();
      const foundAt = reader.ReadUInt32() * 60; // minutes since epoch -> unix seconds
      entries.push({ itemId, monster, foundAt });
    }
    return entries;
  };

  const setEntries = readRawEntries(setCount);
  const uniqueEntries = readRawEntries(uniqueCount);
  const runewordEntries = readRawEntries(runewordCount);

  // Not fully understood (its content shifts and changes as entries are added/removed, likely some
  // kind of progress/summary cache); preserved verbatim so an unmodified read+write roundtrips exactly.
  // Editing the entry lists and writing back will NOT correctly regenerate this region.
  const trailing = reader.ReadBytes((reader.bits.length - reader.offset) / 8);

  stash.chronicle = {
    setItems: setEntries.map(({ itemId, monster, foundAt }) => ({
      item: resolveChronicleItem(itemId, constants.set_items),
      monster,
      foundAt,
    })),
    uniqueItems: uniqueEntries.map(({ itemId, monster, foundAt }) => ({
      item: resolveChronicleItem(itemId, constants.unq_items),
      monster,
      foundAt,
    })),
    runewords: runewordEntries.map(({ itemId, monster, foundAt }) => ({
      item: resolveChronicleItem(itemId, constants.runewords, RUNEWORD_ID_OFFSET, RUNEWORD_ID_OVERRIDES),
      monster,
      foundAt,
    })),
    _unknown_data: {
      envelopePadding,
      trailing,
      originalCounts: { setItems: setCount, uniqueItems: uniqueCount, runewords: runewordCount },
    },
  };
}

// Runeword chronicle ids don't map 1:1 onto constants.runewords' own indices. Most fall at a
// fixed offset (constants.runewords has leading null placeholders before the first real entry),
// but a small, patch-specific cluster of ids use unrelated ids entirely and have no known formula
// - those need to be hardcoded here as they're discovered/reported. As of 105_constant_data,
// the still-unmapped ids are: 10910, 27360-27367, 27650-27652, 27974.
const RUNEWORD_ID_OFFSET = 20480;
const RUNEWORD_ID_OVERRIDES: Record<number, number> = {
  10910: 48,
  27360: 196,
  27361: 197,
  27362: 198,
  27363: 199,
  27364: 200,
  27365: 201,
  27366: 202,
  27367: 203,
  27650: 204,
  27651: 205,
  27652: 206,
  27974: 207,
};

function resolveChronicleItem(id: number, table: any[], offset = 0, overrides: Record<number, number> = {}): types.IChronicleItemData {
  const index = overrides[id] !== undefined ? overrides[id] : id - offset;

  const data = table?.[index];
  return { id, ...data };
}

async function writeChronicle(stash: types.IStash, version: number): Promise<Uint8Array> {
  if (!stash.chronicle) {
    return new Uint8Array();
  }
  const { setItems, uniqueItems, runewords, _unknown_data } = stash.chronicle;

  const writer = new BitWriter();
  writer.WriteUInt32(CHRONICLE_SECTION_MAGIC);
  writer.WriteUInt32(stash.hardcore ? 0 : version === 0x69 ? 2 : 1);
  writer.WriteUInt32(version);
  writer.WriteUInt32(0); // unused (gold slot on regular pages)
  writer.WriteUInt32(0); // size of the sector, fixed below
  writer.WriteBytes(_unknown_data?.envelopePadding ?? new Uint8Array(44));

  writer.WriteUInt32(CHRONICLE_MAGIC);
  writer.WriteUInt16(CHRONICLE_VERSION);
  writer.WriteUInt16(setItems.length);
  writer.WriteUInt16(uniqueItems.length);
  writer.WriteUInt16(runewords.length);
  writer.WriteBytes(new Uint8Array(8).fill(0)); // reserved

  const writeEntry = (itemId: number, monster: number, foundAt: number) => {
    writer.WriteUInt32(itemId);
    writer.WriteUInt16(monster);
    writer.WriteUInt32(Math.floor(foundAt / 60)); // unix seconds -> minutes since epoch
  };
  // Entries are stored newest-first in real saves; enforce that order on write regardless of how
  // the caller built the list, rather than relying on callers to insert/remove at the right spot.
  const newestFirst = (entries: types.IChronicleItemEntry[]) => [...entries].sort((a, b) => b.foundAt - a.foundAt);
  for (const entry of newestFirst(setItems)) writeEntry(entry.item.id, entry.monster, entry.foundAt);
  for (const entry of newestFirst(uniqueItems)) writeEntry(entry.item.id, entry.monster, entry.foundAt);
  for (const entry of newestFirst(runewords)) writeEntry(entry.item.id, entry.monster, entry.foundAt);

  // Not fully understood. If the entry lists are unchanged from what was read, re-emit the
  // captured bytes verbatim so an unmodified roundtrip matches byte-for-byte. If entries were
  // added/removed, those captured bytes are stale (this region's content shifts with entry count),
  // so zero it instead - a 637-entry real save had this region fully zeroed, suggesting all-zero is
  // an accepted state, whereas carrying forward stale bytes for a different entry count is not.
  const countsUnchanged =
    _unknown_data?.originalCounts &&
    _unknown_data.originalCounts.setItems === setItems.length &&
    _unknown_data.originalCounts.uniqueItems === uniqueItems.length &&
    _unknown_data.originalCounts.runewords === runewords.length;
  writer.WriteBytes(countsUnchanged ? _unknown_data.trailing : new Uint8Array(64));

  const size = writer.offset;
  writer.SeekByte(16);
  writer.WriteUInt32(Math.ceil(size / 8));
  return writer.ToArray();
}

async function readStashPage(stash: types.IStash, reader: BitReader, version: number, constants: types.IConstantData) {
  const page: types.IStashPage = {
    items: [],
    name: "",
    type: 0,
  };
  const header = reader.ReadString(2);
  if (header !== "ST") {
    throw new Error(`can not read stash page header ST at position ${reader.offset - 2 * 8}`);
  }

  page.type = reader.ReadUInt32();

  page.name = reader.ReadNullTerminatedString();
  page.items = await items.readItems(reader, version, constants, defaultConfig);
  enhanceItems(page.items, constants, 1);
  stash.pages.push(page);
}

async function readStashPart(stash: types.IStash, reader: BitReader, version: number, constants: types.IConstantData, pageIndex?: number) {
  const currentPage = pageIndex !== undefined ? stash.pages[pageIndex] : undefined;
  const page: types.IStashPage = currentPage || {
    items: [],
    name: "",
    type: 0,
  };
  page.items = await items.readItems(reader, version, constants, defaultConfig);
  enhanceItems(page.items, constants, 1);
  if (!currentPage) {
    stash.pages.push(page);
  }
}

export async function write(
  data: types.IStash,
  constants: types.IConstantData,
  version: number,
  userConfig?: types.IConfig
): Promise<Uint8Array> {
  const config = Object.assign(defaultConfig, userConfig);
  const writer = new BitWriter();
  if (!constants) {
    constants = getConstantData(version);
  }
  if (version > 0x61) {
    for (const page of data.pages) {
      writer.WriteArray(await writeStashSection(data, page, constants, config));
    }
    if (version === 0x69 && data.chronicle) {
      writer.WriteArray(await writeChronicle(data, version));
    }
  } else {
    writer.WriteArray(await writeStashHeader(data));
    writer.WriteArray(await writeStashPages(data, version, constants, config));
  }
  return writer.ToArray();
}

async function writeStashHeader(data: types.IStash): Promise<Uint8Array> {
  const writer = new BitWriter();
  if (data.type === types.EStashType.private) {
    writer.WriteString("CSTM", 4);
  } else {
    writer.WriteString("SSS", 4);
  }

  writer.WriteString(data.version, data.version.length);

  if (data.type === types.EStashType.private) {
    writer.WriteString("", 4);
  } else {
    if (data.version == "02") {
      writer.WriteUInt32(data.sharedGold);
    }
  }
  writer.WriteUInt32(data.pages.length);
  return writer.ToArray();
}

async function writeStashSection(
  data: types.IStash,
  page: types.IStashPage,
  constants: types.IConstantData,
  userConfig: types.IConfig
): Promise<Uint8Array> {
  const writer = new BitWriter();
  const version = parseInt(data.version);
  writer.WriteUInt32(0xaa55aa55);
  writer.WriteUInt32(data.hardcore ? 0 : version === 0x69 ? 2 : 1); // change to 0x02
  writer.WriteUInt32(version);
  const maxGold = Math.min(data.sharedGold, 2500000);
  data.sharedGold = Math.max(0, data.sharedGold - maxGold);
  writer.WriteUInt32(maxGold);
  writer.WriteUInt32(0); // size of the sector, to be fixed later
  if (version === 0x69) {
    writer.WriteByte(page.isStackable || 0);
    writer.WriteBytes(new Uint8Array(43).fill(0)); // empty
  } else {
    writer.WriteBytes(new Uint8Array(44).fill(0)); // empty
  }
  writer.WriteArray(await items.writeItems(page.items, parseInt(data.version), constants, userConfig));
  const size = writer.offset;
  writer.SeekByte(16);
  writer.WriteUInt32(Math.ceil(size / 8));
  return writer.ToArray();
}

async function writeStashPages(
  data: types.IStash,
  version: number,
  constants: types.IConstantData,
  config: types.IConfig
): Promise<Uint8Array> {
  const writer = new BitWriter();

  for (let i = 0; i < data.pages.length; i++) {
    writer.WriteArray(await writeStashPage(data.pages[i], version, constants, config));
  }

  return writer.ToArray();
}

async function writeStashPage(
  data: types.IStashPage,
  version: number,
  constants: types.IConstantData,
  config: types.IConfig
): Promise<Uint8Array> {
  const writer = new BitWriter();

  writer.WriteString("ST", 2);
  writer.WriteUInt32(data.type);

  writer.WriteString(data.name, data.name.length + 1);
  writer.WriteArray(await items.writeItems(data.items, version, constants, config));

  return writer.ToArray();
}
