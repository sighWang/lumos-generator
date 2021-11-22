import { TransactionSkeletonType, TransactionSkeleton, generateAddress, Options, createTransactionFromSkeleton} from "@ckb-lumos/helpers";
import { RPC } from "@ckb-lumos/rpc";
import { Input, Script, OutPoint, CellProvider, Cell, Transaction } from "@ckb-lumos/base";
import { Config, getConfig } from "@ckb-lumos/config-manager";
import { generateTypeID } from "./typeID";
import { bytesToHex, findCellsByLock, completeTx, updateCellDeps, updateOutputs, calculateCodeHashByBin, getDataHash, injectCapacity } from "./utils";
import { SerializeTransaction } from "@ckb-lumos/base/lib/core";
import { normalizers } from "ckb-js-toolkit";

export function generateTypeIdScript(input: Input /* must be an UTxO */, outputIndex: number): Script {
  const args = generateTypeID(input, outputIndex);
  return {
    code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944', // Buffer.from('TYPE_ID')
    hash_type: 'type',
    args,
  };
};

interface DeployOptions {
  cellProvider: CellProvider;
  fromLock: Script;
  scriptBinary: Uint8Array;
  config?: Config;
}

// the generator will only collect cells that have only lock
export async function generateDeployWithDataTx(options: DeployOptions): Promise<TransactionSkeletonType> {
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });

  const fromLockscript = options.fromLock;
  const fromAddress = generateAddress(fromLockscript, { config: options.config });

  const output: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: fromLockscript,
      // type: null,
    },
    data: bytesToHex(options.scriptBinary),
  };

  txSkeleton = updateOutputs(txSkeleton, output);
  txSkeleton = updateCellDeps(txSkeleton, options.config);
  txSkeleton = await completeTx(txSkeleton, fromAddress, options.config);

  return txSkeleton;
};

export async function generateDeployWithTypeIdTx(options: DeployOptions): Promise<[Script /* type_id script */, TransactionSkeletonType]> {
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });

  const fromLockscript = options.fromLock;
  const fromAddress = generateAddress(fromLockscript, { config: options.config });

  const [resolved] = await findCellsByLock(fromLockscript, options.cellProvider);
  if (!resolved) throw new Error(`${fromAddress} has no live ckb`);

  const typeId = generateTypeIdScript({ previous_output: resolved.out_point!, since: '0x0' }, 0);
  console.log("typeid is: ", typeId);
  const output: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: fromLockscript,
      type: typeId,
    },
    data: bytesToHex(options.scriptBinary),
  };

  txSkeleton = updateOutputs(txSkeleton, output);
  txSkeleton = updateCellDeps(txSkeleton, options.config);
  txSkeleton = await completeTx(txSkeleton, fromAddress, options.config);

  return [typeId, txSkeleton];
};

interface UpgradeOptions extends DeployOptions {
  typeId: Script;
}

export async function generateUpgradeTypeIdDataTx(options: UpgradeOptions): Promise<TransactionSkeletonType> {
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });

  const fromLockscript = options.fromLock;
  const fromAddress = generateAddress(fromLockscript, { config: options.config });

  const collector = options.cellProvider.collector({ type: options.typeId });
  const cells: Cell[] = [];
  for await (const cell of collector.collect()) {
    console.log(cell);
    cells.push(cell);
  }
  if (cells.length !== 1) throw new Error("the typeid maybe wrong");

  const deployedCell = cells[0];
  txSkeleton = txSkeleton.update('inputs', (inputs) => {
    return inputs.push(deployedCell);
  });

  const output: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: fromLockscript,
      type: options.typeId,
    },
    data: bytesToHex(options.scriptBinary),
  };

  txSkeleton = updateOutputs(txSkeleton, output);
  txSkeleton = updateCellDeps(txSkeleton, options.config);
  txSkeleton = await completeTx(txSkeleton, fromAddress, options.config);

  return txSkeleton;
};

export async function compareScriptBinaryWithOnChainData(scriptBinary: Uint8Array, outPoint: OutPoint, rpc: RPC): Promise<boolean> {
  const localHash = calculateCodeHashByBin(scriptBinary);
  const onChainHash = await getDataHash(outPoint, rpc);
  return localHash === onChainHash;
}

export async function payFee(
  txSkeleton: TransactionSkeletonType,
  fromAddress: string,
  amount: bigint,
  { config = undefined }: Options = {}
): Promise<TransactionSkeletonType> {
  config = config || getConfig();
  return await injectCapacity(txSkeleton, fromAddress, amount, {
    config,
  });
}

export function calculateFee(size: number, feeRate: bigint): bigint {
  const ratio = 1000n;
  const base = BigInt(size) * feeRate;
  const fee = base / ratio;
  if (fee * ratio < base) {
    return fee + 1n;
  }
  return fee;
}

export function getTransactionSize(txSkeleton: TransactionSkeletonType): number {
  const tx = createTransactionFromSkeleton(txSkeleton);
  return getTransactionSizeByTx(tx);
}

function getTransactionSizeByTx(tx: Transaction): number {
  const serializedTx = SerializeTransaction(
    normalizers.NormalizeTransaction(tx)
  );
  // 4 is serialized offset bytesize
  const size = serializedTx.byteLength + 4;
  return size;
}
