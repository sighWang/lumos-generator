import { addressToScript } from '@ckb-lumos/helpers';
import * as fs from 'fs';

const BINARY_PATH = './sudt';
const sudtBin = fs.readFileSync(BINARY_PATH);

const ALICE = {
  PRIVATE_KEY:
    "f571db32dace55dc75f6df7f2e1a0fb0ec730cfdde2ed6e5a4998673503d513b",
  ADDRESS: "ckt1qyqptxys5l9vk39ft0hswscxgseawc77y2wqlr558h",
  ARGS: "0x159890a7cacb44a95bef0743064433d763de229c",
  //LOCKHASH: "0x173924b290925c48a9cd55d00360fd6ad81e2081c8e0ada42dce1aafd2cfc1cf"
};
const lockScript = addressToScript(ALICE.ADDRESS);

const opt = {
  cellProvider: CellProvider,
  fromLock: lockScript,
  scriptBinary: sudtBin,
}