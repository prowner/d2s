import { expect } from 'chai';
import { readItems, readItem, writeItem } from '../../src/d2/items';
import * as types from '../../src/d2/types';
import { BinaryReader } from '../../src/binary/binaryreader';
import { _writeBits } from '../../src/util';
import { constants } from '../../src/data/versions/96_constant_data';

describe('items', () => {

  let config = {
    extendedStash: false
  } as types.IConfig;


  /*
HP1
Uint8Array(10) [16, 0, 160, 0, 5, 228, 4, 207, 79, 0]

HP2
Uint8Array(9) [16, 0, 160, 0, 5, 228, 4, 79, 38]

HP3
Uint8Array(10) [16, 0, 160, 0, 5, 228, 4, 207, 109, 0]

HP4
Uint8Array(10) [16, 0, 160, 0, 5, 228, 4, 207, 175, 0]

HP5
Uint8Array(10) [16, 0, 160, 0, 5, 228, 4, 79, 180, 0]
  */

  xit('should read "simple" item 1.15', async() => {
    //hp1 from game
    //let buffer = new Uint8Array([16,32,130,0,13,17,0,63,30,22,187,92,65,2,2,14,14,255,1]);
    let buffer, reader, item;
    //HP1 (inv, col=9, row=3)
    buffer = new Uint8Array([16, 0, 160, 0, 5, 228, 4, 207, 79, 0]);
    reader = new BinaryReader(buffer).SetLittleEndian();
    item = await readItem(reader, constants, config);

    //HP2 (inv, col=9, row=3)
    buffer = new Uint8Array([16, 0, 160, 0, 5, 228, 4, 79, 38]);
    reader = new BinaryReader(buffer).SetLittleEndian();
    item = await readItem(reader, constants, config);

    //HP3 (inv, col=9, row=3)
    buffer = new Uint8Array([16, 0, 160, 0, 5, 228, 4, 207, 109, 0]);
    reader = new BinaryReader(buffer).SetLittleEndian();
    item = await readItem(reader, constants, config);

    //HP4 (inv, col=9, row=3)
    buffer = new Uint8Array([16, 0, 160, 0, 5, 228, 4, 207, 175, 0]);
    reader = new BinaryReader(buffer).SetLittleEndian();
    item = await readItem(reader, constants, config);

    //HP5 (inv, col=9, row=3)
    buffer = new Uint8Array([16, 0, 160, 0, 5, 228, 4, 79, 180, 0]);
    reader = new BinaryReader(buffer).SetLittleEndian();
    item = await readItem(reader, constants, config);

    expect(item.type).to.eq("hp1");
    expect(item.simple_item).to.eq(1);
  });


  it('should read "simple" item', async() => {
    //hp1 from game
    let buffer = new Uint8Array([74,77,16,32,34,0,0,8,0,128,6,23,3,2]);
    let reader = new BinaryReader(buffer).SetLittleEndian();
    let item = await readItem(reader, constants, config);
    expect(item.type).to.eq("hp1");
    expect(item.simple_item).to.eq(1);
  });

  it('should write "simple" item', async() => {
    let item = {
      identified: 1,
      socketed: 0,
      new: 1,
      is_ear: 0,
      starter_item: 1,
      simple_item: 1,
      ethereal: 0,
      personalized: 0,
      given_runeword: 0,
      location_id: 2,
      equipped_id: 0,
      position_x: 0,
      position_y: 0,
      alt_position_id: 0,
      type: "hp1",
      type_id: 4,
      nr_of_items_in_sockets: 0,
      version: 0
    } as types.IItem;
    let bytes = await writeItem(item, constants, config);
    expect(bytes).to.eql(new Uint8Array([74,77,16,32,162,0,0,8,0,128,6,23,3,2]));
  });

  it('should read item list', async () => {
    //barb starter items; 4 pots, tp, id, hand axe, shield
    let buffer = new Uint8Array([74,77,8,0,74,77,16,32,162,0,101,8,0,128,6,23,3,2,74,77,16,32,162,0,101,8,2,128,6,23,3,2,74,77,16,32,162,0,101,8,4,128,6,23,3,2,74,77,16,32,162,0,101,8,6,128,6,23,3,2,74,77,16,32,162,0,101,0,114,66,55,55,6,2,74,77,16,32,162,0,101,0,82,146,54,55,6,2,74,77,16,32,130,0,101,132,8,128,22,134,7,2,73,10,205,163,128,128,131,195,127,74,77,16,32,130,0,101,164,10,32,86,55,6,2,13,71,163,205,128,224,1,12,12,254,3]);
    let reader = new BinaryReader(buffer).SetLittleEndian();
    let items = readItems(reader, constants, config);
    expect(items.length).to.eq(8);
  });

});