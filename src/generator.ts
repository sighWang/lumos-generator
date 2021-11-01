import { TransactionSkeletonType, TransactionSkeleton, generateAddress } from "@ckb-lumos/helpers";
import { RPC } from "@ckb-lumos/rpc";
import { Input, Script, OutPoint, CellProvider, Cell } from "@ckb-lumos/base";
import { Config } from "@ckb-lumos/config-manager";
import { generateTypeID } from "./typeID";
import { bytesToHex, findCellsByLock, completeTx, updateCellDeps, updateOutputs, calculateCodeHashByBin, getDataHash } from "./utils";

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
  scriptBinary: Buffer;
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
  txSkeleton = await completeTx(txSkeleton, fromAddress);

  return updateCellDeps(txSkeleton);
};

export async function generateDeployWithTypeIdTx(options: DeployOptions): Promise<TransactionSkeletonType> {
  let txSkeleton = TransactionSkeleton({ cellProvider: options.cellProvider });

  const fromLockscript = options.fromLock;
  const fromAddress = generateAddress(fromLockscript, { config: options.config });

  const [resolved] = await findCellsByLock(fromLockscript, options.cellProvider);
  if (!resolved) throw new Error(`${fromAddress} has no live ckb`);

  const typeId = generateTypeIdScript({ previous_output: resolved.out_point!, since: '0x0' }, 0);
  const output: Cell = {
    cell_output: {
      capacity: '0x0',
      lock: fromLockscript,
      type: typeId,
    },
    data: bytesToHex(options.scriptBinary),
  };

  txSkeleton = updateOutputs(txSkeleton, output);
  txSkeleton = await completeTx(txSkeleton, fromAddress);

  return updateCellDeps(txSkeleton);
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
  txSkeleton = await completeTx(txSkeleton, fromAddress);

  return updateCellDeps(txSkeleton);
};

export async function compareScriptBinaryWithOnChainData(scriptBinary: Buffer, outPoint: OutPoint, rpc: RPC): Promise<boolean> {
  const localHash = calculateCodeHashByBin(scriptBinary);
  const onChainHash = await getDataHash(outPoint, rpc);
  return localHash === onChainHash;
}
