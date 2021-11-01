import { TransactionSkeletonType, minimalCellCapacity } from "@ckb-lumos/helpers";
import { common } from '@ckb-lumos/common-scripts';
import { RPC } from "@ckb-lumos/rpc";
import { Script, CellProvider, Cell, utils, OutPoint } from "@ckb-lumos/base";
import { Reader } from "ckb-js-toolkit";

export function bytesToHex(bytes: Uint8Array): string {
  return `0x${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export async function findCellsByLock(lockScript: Script, cellProvider: CellProvider): Promise<Cell[]> {
  const collector = cellProvider.collector({ lock: lockScript });
  const cells: Cell[] = [];
  for await (const cell of collector.collect()) {
    cells.push(cell);
  }
  return cells;
};

export async function completeTx(
  txSkeleton: TransactionSkeletonType,
  fromAddress: string,
  feeRate = BigInt(10000),
): Promise<TransactionSkeletonType> {
  const inputCapacity = txSkeleton
    .get('inputs')
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  const outputCapacity = txSkeleton
    .get('outputs')
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  const needCapacity = outputCapacity - inputCapacity + BigInt(10) ** BigInt(8);
  txSkeleton = await common.injectCapacity(txSkeleton, [fromAddress], needCapacity, undefined, undefined, {
    enableDeductCapacity: false,
  });
  txSkeleton = await common.payFeeByFeeRate(txSkeleton, [fromAddress], feeRate);
  return txSkeleton;
}

export function updateOutputs(txSkeleton: TransactionSkeletonType, output: Cell): TransactionSkeletonType {
  const cellCapacity = minimalCellCapacity(output);
  output.cell_output.capacity = `0x${cellCapacity.toString(16)}`;
  txSkeleton = txSkeleton.update('outputs', (outputs) => {
    return outputs.push(output);
  });

  return txSkeleton;
}

export function updateCellDeps(txSkeleton: TransactionSkeletonType): TransactionSkeletonType {
  txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    return cellDeps.clear();
  });
  txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    return cellDeps.push({
      out_point: { tx_hash: "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8", index: "0x0" },
      dep_type: "dep_group",
    });
  });

  return txSkeleton;
}

export function calculateCodeHashByBin(scriptBin: Buffer): string {
  const bin = scriptBin.valueOf();
  return new utils.CKBHasher().update(bin.buffer.slice(bin.byteOffset, bin.byteLength + bin.byteOffset)).digestHex();
}

export async function getDataHash(outPoint: OutPoint, rpc: RPC): Promise<string> {
  const txHash = outPoint.tx_hash;
  const index = parseInt(outPoint.index, 10);
  const tx = await rpc.get_transaction(txHash);

  if (!tx) throw new Error(`TxHash(${txHash}) is not found`);

  const outputData = tx.transaction.outputs_data[index];
  if (!outputData) throw new Error(`cannot find output data`);

  return new utils.CKBHasher().update(new Reader(outputData)).digestHex();
}
