import { core, HexString, Input, utils } from '@ckb-lumos/base';
import { toBuffer } from '@ckitjs/easy-byte';
import { normalizers } from 'ckb-js-toolkit';

function toArrayBuffer(buf: Uint8Array) {
  const ab = new ArrayBuffer(buf.length);
  const view = new Uint8Array(ab);

  for (let i = 0; i < buf.length; ++i) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    view[i] = buf[i]!;
  }
  return ab;
}

function toBigUInt64LE(num: HexString | number | bigint) {
  num = Number(BigInt(num));
  const buf = toBuffer('', 8);
  buf.writeBigUInt64LE(num, 0);
  return toArrayBuffer(buf);
}

export function generateTypeID(input: Input, outputIndex: number) {
  const outPointBuf = core.SerializeCellInput(normalizers.NormalizeCellInput(input));
  const outputIndexBuf = toBigUInt64LE(outputIndex);
  const ckbHasher = new utils.CKBHasher();
  ckbHasher.update(outPointBuf);
  ckbHasher.update(outputIndexBuf);
  return ckbHasher.digestHex();
}