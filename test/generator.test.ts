import { expect } from 'chai';
import { parseAddress, TransactionSkeletonType, sealTransaction } from '@ckb-lumos/helpers';
import { common } from '@ckb-lumos/common-scripts';
import { key } from "@ckb-lumos/hd";
import { RPC } from "@ckb-lumos/rpc";
import * as fs from 'fs';
import { compareScriptBinaryWithOnChainData, generateDeployWithTypeIdTx, generateDeployWithDataTx, generateUpgradeTypeIdDataTx } from '../src/generator';
import { getConfig, initializeConfig } from '@ckb-lumos/config-manager';
import { Provider } from '../src/provider';
import { dirname } from 'path'; 

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

function nonNullable<X>(x: X): NonNullable<X> {
  if (x == null) throw new Error('Null check failed');
  return x as NonNullable<X>;
}

async function generateConfig() {
  let config = {
    "PREFIX": "ckt",
    "SCRIPTS": {
      "SECP256K1_BLAKE160": {
        "CODE_HASH": "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
        "HASH_TYPE": "type",
        "TX_HASH": "",
        "INDEX": "0x0",
        "DEP_TYPE": "dep_group",
        "SHORT_ID": 0
      }
    }
  }

  const genesisBlock = await rpc.get_block_by_number('0x0');
  if (!genesisBlock) throw new Error('cannot load genesis block');
  const secp256k1DepTxHash = nonNullable(genesisBlock.transactions[1]).hash;

  config.SCRIPTS.SECP256K1_BLAKE160.TX_HASH = secp256k1DepTxHash!;

  fs.promises.mkdir(dirname("config.json"), {recursive: true}).then(x => fs.promises.writeFile("config.json", JSON.stringify(config)))
  
}

let opt;

before(async () => {
  await generateConfig();
  initializeConfig();

  const config = getConfig();
  const lockScript = parseAddress(ALICE.ADDRESS, { config });

  opt = {
    cellProvider: new Provider(),
    fromLock: lockScript,
    scriptBinary: sudtBin,
  }
})

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

function asyncSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForTransactionCommitted(
  txHash: string,
  provider: Provider,
  options: { pollIntervalMs?: number; timeoutMs?: number } = {},
) {
  const { pollIntervalMs = 1000, timeoutMs = 120000 } = options;
  const start = Date.now();

  while (Date.now() - start <= timeoutMs) {
    const tx = await rpc.get_transaction(txHash);
    if (tx?.tx_status?.status === 'committed') {
      console.log("committed")
      break;
    }
    console.log("polling: ", tx?.tx_status?.status)
    await asyncSleep(pollIntervalMs);
  }

  const rpcTip = Number(await rpc.get_tip_block_number());

  while (Date.now() - start <= timeoutMs) {
    const providerTip = await provider.get_tip();
    if (Number(providerTip.block_number) >= rpcTip) return;

    await asyncSleep(pollIntervalMs);
  }

  return;
}

// it('DeployWithData', async function() {
//   const txSkeleton = await generateDeployWithDataTx(opt);
//   const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
//   const outPoint = {
//     tx_hash: txHash,
//     index: "0x0"
//   }
//   const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
//   expect(compareResult).equal(true);
// }); 

it('DeployWithTypeId', async function() {
  const txSkeleton = await generateDeployWithTypeIdTx(opt);
  const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
  const outPoint = {
    tx_hash: txHash,
    index: "0x0"
  }
  const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
  expect(compareResult).equal(true);

  const tx = await rpc.get_transaction(txHash);
  const optUpgrade = {
    cellProvider: new Provider(),
    fromLock: opt.fromLock,
    scriptBinary: sudtBin,
    typeId: tx!.transaction.outputs[0].type!
  }

  await waitForTransactionCommitted(txHash, optUpgrade.cellProvider);

  const upgradeTxSkeleton = await generateUpgradeTypeIdDataTx(optUpgrade);
  const upgradeTxHash = await signAndSendTransaction(upgradeTxSkeleton, ALICE.PRIVATE_KEY, rpc);
  const upgradeOutPoint = {
    tx_hash: upgradeTxHash,
    index: "0x0"
  }
  const upgradeCompareResult = await compareScriptBinaryWithOnChainData(sudtBin, upgradeOutPoint, rpc);
  expect(upgradeCompareResult).equal(true);
}); 
