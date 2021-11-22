import { expect } from 'chai';
import { parseAddress, TransactionSkeletonType, sealTransaction } from '@ckb-lumos/helpers';
import { common } from '@ckb-lumos/common-scripts';
import { key } from "@ckb-lumos/hd";
import { RPC } from "@ckb-lumos/rpc";
import * as fs from 'fs';
import { compareScriptBinaryWithOnChainData, generateDeployWithTypeIdTx, generateDeployWithDataTx, generateUpgradeTypeIdDataTx, payFee, getTransactionSize, calculateFee,  } from '../src/generator';
import { getConfig, initializeConfig } from '@ckb-lumos/config-manager';
import { Provider } from '../src/provider';
import { dirname } from 'path'; 
import { env } from "process";
import { predefined } from "@ckb-lumos/config-manager";
const { AGGRON4 } = predefined;

const BINARY_PATH = './bin/sudt';
const sudtBin = Uint8Array.of(1);
const rpc = new RPC("https://testnet.ckb.dev/rpc");

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
      },
      "SECP256K1_BLAKE160_MULTISIG": {
        "CODE_HASH": "0x5c5069eb0857efc65e1bca0c07df34c31663b3622fd3876c876320fc9634e2a8",
        "HASH_TYPE": "type",
        "TX_HASH": "",
        "INDEX": "0x1",
        "DEP_TYPE": "dep_group",
        "SHORT_ID": 1
      }
    }
  }

  const genesisBlock = await rpc.get_block_by_number('0x0');
  if (!genesisBlock) throw new Error('cannot load genesis block');
  const txHash = nonNullable(genesisBlock.transactions[1]).hash;

  config.SCRIPTS.SECP256K1_BLAKE160.TX_HASH = txHash!;
  config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG.TX_HASH = txHash!;

  fs.promises.mkdir(dirname("config.json"), {recursive: true}).then(x => fs.promises.writeFile("config.json", JSON.stringify(config)))
  
}

let opt;

before(async () => {
  // await generateConfig();
  // initializeConfig();

  // const config = getConfig();
  const lockScript = parseAddress(ALICE.ADDRESS, { config: AGGRON4 });

  opt = {
    cellProvider: new Provider(),
    fromLock: lockScript,
    scriptBinary: sudtBin,
    config: AGGRON4
  }
})

async function signAndSendTransaction(
  txSkeleton: TransactionSkeletonType,
  privatekey: string,
  rpc: RPC
): Promise<string> {
  txSkeleton = common.prepareSigningEntries(txSkeleton);
  console.log("signingEntries: ", txSkeleton.get("signingEntries").get(0))
  const message = txSkeleton.get("signingEntries").get(0)?.message;
  const Sig = key.signRecoverable(message!, privatekey);
  const tx = sealTransaction(txSkeleton, [Sig]);
  const hash = await rpc.send_transaction(tx, "passthrough");
  console.log("The transaction hash is", hash);
  return hash;
}

async function payFeeConst(txSkeleton: TransactionSkeletonType): Promise<TransactionSkeletonType> {
  const feeRate = BigInt(1000);
  let size: number = 0;
  let newTxSkeleton: TransactionSkeletonType = txSkeleton;

  /**
   * Only one case `currentTransactionSize < size` :
   * change output capacity equals current fee (feeA), so one output reduced,
   * and if reduce the fee, change output will add again, fee will increase to feeA.
   */
  let currentTransactionSize: number = getTransactionSize(newTxSkeleton);
  while (currentTransactionSize > size) {
    size = currentTransactionSize;
    const fee: bigint = calculateFee(size, feeRate);

    newTxSkeleton = await payFee(txSkeleton, ALICE.ADDRESS, fee, {
      config: AGGRON4,
    });
    currentTransactionSize = getTransactionSize(newTxSkeleton);
  }

  return newTxSkeleton;
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
//   let txSkeleton = await generateDeployWithDataTx(opt);
//   txSkeleton = await payFeeConst(txSkeleton)
//   const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
//   const outPoint = {
//     tx_hash: txHash,
//     index: "0x0"
//   }
//   const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
//   expect(compareResult).equal(true);
// }); 

it('DeployWithTypeId', async function() {
  // let [typeid, txSkeleton] = await generateDeployWithTypeIdTx(opt);
  // txSkeleton = await payFeeConst(txSkeleton);
  // const txHash = await signAndSendTransaction(txSkeleton, ALICE.PRIVATE_KEY, rpc);
  // const outPoint = {
  //   tx_hash: txHash,
  //   index: "0x0"
  // }
  // const compareResult = await compareScriptBinaryWithOnChainData(sudtBin, outPoint, rpc);
  // expect(compareResult).equal(true);

  // const tx = await rpc.get_transaction(txHash);
  const optUpgrade = {
    cellProvider: new Provider(),
    fromLock: opt.fromLock,
    scriptBinary: Uint8Array.of(1, 2, 3),
    config: AGGRON4,
    typeId: {
      code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
      hash_type: "type" as const,
      args: '0xe9451f3528af55247ff7d3851a00b54a5fe7de38d40dc29580ce2c069332633a'
    }
  }

  // // await waitForTransactionCommitted(txHash, optUpgrade.cellProvider);

  let upgradeTxSkeleton = await generateUpgradeTypeIdDataTx(optUpgrade);
  upgradeTxSkeleton = await payFeeConst(upgradeTxSkeleton);
  // upgradeTxSkeleton = common.prepareSigningEntries(upgradeTxSkeleton);
  // console.log("signingEntries: ", upgradeTxSkeleton.get("signingEntries").get(0))
  // expect(upgradeTxSkeleton.get("signingEntries")!.get(0)!.message!).equal("0xe7582f02e85d259a523aa75348c7c275d8a389412cf5c09c6d511b20304eac7e");
  const upgradeTxHash = await signAndSendTransaction(upgradeTxSkeleton, ALICE.PRIVATE_KEY, rpc);
  const upgradeOutPoint = {
    tx_hash: upgradeTxHash,
    index: "0x0"
  }
  const upgradeCompareResult = await compareScriptBinaryWithOnChainData(sudtBin, upgradeOutPoint, rpc);
  expect(upgradeCompareResult).equal(true);
}); 
