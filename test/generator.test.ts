import { expect } from 'chai';
import { parseAddress, TransactionSkeletonType, sealTransaction } from '@ckb-lumos/helpers';
import { common } from '@ckb-lumos/common-scripts';
import { key } from "@ckb-lumos/hd";
import { RPC } from "@ckb-lumos/rpc";
import * as fs from 'fs';
import { compareScriptBinaryWithOnChainData, generateDeployWithTypeIdTx, generateDeployWithDataTx } from '../src/generator';
import { getConfig } from '@ckb-lumos/config-manager';
import { Provider } from '../src/provider';

const BINARY_PATH = './bin/sudt';
const sudtBin = fs.readFileSync(BINARY_PATH);
const rpc = new RPC("http://127.0.0.1:8114");

const ALICE = {
  PRIVATE_KEY:
    "0xf571db32dace55dc75f6df7f2e1a0fb0ec730cfdde2ed6e5a4998673503d513b",
  ADDRESS: "ckt1qyqptxys5l9vk39ft0hswscxgseawc77y2wqlr558h",
  ARGS: "0x159890a7cacb44a95bef0743064433d763de229c",
  //LOCKHASH: "0x173924b290925c48a9cd55d00360fd6ad81e2081c8e0ada42dce1aafd2cfc1cf"
};

const defaulyConfig = getConfig();
const config = {
  PREFIX: "ckt",
  SCRIPTS: defaulyConfig.SCRIPTS
}
const lockScript = parseAddress(ALICE.ADDRESS, { config });

const opt = {
  cellProvider: new Provider(),
  fromLock: lockScript,
  scriptBinary: sudtBin,
}

async function signAndSendTransaction(
  txSkeleton: TransactionSkeletonType,
  privatekey: string,
  rpc: RPC
): Promise<string> {
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  const message = txSkeleton.get("signingEntries").get(0)?.message;
  const Sig = key.signRecoverable(message!, privatekey);
  const tx = sealTransaction(txSkeleton, [Sig]);
  const hash = await rpc.send_transaction(tx, "passthrough");
  console.log("The transaction hash is", hash);
  return hash;
}

it('DeployWithData', async function() {
  const txSkeleton = await generateDeployWithDataTx(opt);
  const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
  const outPoint = {
    tx_hash: txHash,
    index: "0x0"
  }
  const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
  expect(compareResult).equal(true);
}); 

it('DeployWithTypeId', async function() {
  const txSkeleton = await generateDeployWithTypeIdTx(opt);
  const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
  const outPoint = {
    tx_hash: txHash,
    index: "0x0"
  }
  const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
  expect(compareResult).equal(true);
}); 
