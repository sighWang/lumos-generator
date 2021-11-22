import { TransactionSkeletonType, minimalCellCapacity,
  Options,
  parseAddress, } from "@ckb-lumos/helpers";
import { common } from '@ckb-lumos/common-scripts';
import { RPC } from "@ckb-lumos/rpc";
import { Script, CellProvider, Cell, utils, OutPoint, values,
  core,
  WitnessArgs, } from "@ckb-lumos/base";
import { Reader, normalizers } from "ckb-js-toolkit";
import { Config, getConfig } from '@ckb-lumos/config-manager';
import { Set } from "immutable";
const { ScriptValue } = values;

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
  config?: Config,
): Promise<TransactionSkeletonType> {
  const inputCapacity = txSkeleton
    .get('inputs')
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  const outputCapacity = txSkeleton
    .get('outputs')
    .map((c) => BigInt(c.cell_output.capacity))
    .reduce((a, b) => a + b, BigInt(0));
  const needCapacity = outputCapacity - inputCapacity;
  txSkeleton = await injectCapacity(txSkeleton, fromAddress, needCapacity, {
    config: config,
  });
  // console.log(txSkeleton.get("inputs").get(0));
  // console.log(txSkeleton.get("inputs").get(1));
  // console.log(txSkeleton.get("inputs").get(2));
  return txSkeleton;
}

export async function injectCapacity(
  txSkeleton: TransactionSkeletonType,
  fromAddress: string,
  amount: bigint,
  { config = undefined }: Options = {}
): Promise<TransactionSkeletonType> {
  config = config || getConfig();
  const fromScript = parseAddress(fromAddress, { config });
  amount = BigInt(amount);

  if (amount > 0n) {
    const cellProvider = txSkeleton.get("cellProvider");
    if (!cellProvider) throw new Error("Cell provider is missing!");
    const cellCollector = cellProvider.collector({
      lock: fromScript,
      type: "empty",
    });

    const changeCell: Cell = {
      cell_output: {
        capacity: "0x0",
        lock: fromScript,
        type: undefined,
      },
      data: "0x",
    };
    const minimalChangeCapacity: bigint = minimalCellCapacity(changeCell);

    let changeCapacity: bigint = 0n;

    let previousInputs = Set<string>();
    for (const input of txSkeleton.get("inputs")) {
      previousInputs = previousInputs.add(
        `${input.out_point!.tx_hash}_${input.out_point!.index}`
      );
    }

    for await (const inputCell of cellCollector.collect()) {
      if (
        previousInputs.has(
          `${inputCell.out_point!.tx_hash}_${inputCell.out_point!.index}`
        )
      )
        continue;
      txSkeleton = txSkeleton.update("inputs", (inputs) => 
        inputs.push(inputCell)
      );
      console.log("INPUTCELL:", inputCell);
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
      const inputCapacity = BigInt(inputCell.cell_output.capacity);
      let deductCapacity = inputCapacity;
      if (deductCapacity > amount) {
        deductCapacity = amount;
      }
      amount -= deductCapacity;
      changeCapacity += inputCapacity - deductCapacity;
      if (
        amount === BigInt(0) &&
        (changeCapacity === BigInt(0) || changeCapacity > minimalChangeCapacity)
      )
        break;
    }

    if (changeCapacity > BigInt(0)) {
      changeCell.cell_output.capacity = "0x" + changeCapacity.toString(16);
      txSkeleton = txSkeleton.update("outputs", (outputs) =>
        outputs.push(changeCell)
      );
    }
  }

  if (amount > 0n) throw new Error("Not enough capacity in from address!");

  /*
   * Modify the skeleton, so the first witness of the fromAddress script group
   * has a WitnessArgs construct with 65-byte zero filled values. While this
   * is not required, it helps in transaction fee estimation.
   */
  const firstIndex = txSkeleton
    .get("inputs")
    .findIndex((input) =>
      new ScriptValue(input.cell_output.lock, { validate: false }).equals(
        new ScriptValue(fromScript, { validate: false })
      )
    );
  if (firstIndex !== -1) {
    while (firstIndex >= txSkeleton.get("witnesses").size) {
      txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
        witnesses.push("0x")
      );
    }
    let witness: string = txSkeleton.get("witnesses").get(firstIndex)!;
    const newWitnessArgs: WitnessArgs = {
      /* 65-byte zeros in hex */
      lock:
        "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    };
    if (witness !== "0x") {
      const witnessArgs = new core.WitnessArgs(new Reader(witness));
      const lock = witnessArgs.getLock();
      if (
        lock.hasValue() &&
        new Reader(lock.value().raw()).serializeJson() !== newWitnessArgs.lock
      ) {
        throw new Error(
          "Lock field in first witness is set aside for signature!"
        );
      }
      const inputType = witnessArgs.getInputType();
      if (inputType.hasValue()) {
        newWitnessArgs.input_type = new Reader(
          inputType.value().raw()
        ).serializeJson();
      }
      const outputType = witnessArgs.getOutputType();
      if (outputType.hasValue()) {
        newWitnessArgs.output_type = new Reader(
          outputType.value().raw()
        ).serializeJson();
      }
    }
    witness = new Reader(
      core.SerializeWitnessArgs(
        normalizers.NormalizeWitnessArgs(newWitnessArgs)
      )
    ).serializeJson();
    txSkeleton = txSkeleton.update("witnesses", (witnesses) =>
      witnesses.set(firstIndex, witness)
    );
  }

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

export function updateCellDeps(txSkeleton: TransactionSkeletonType, config?: Config): TransactionSkeletonType {
  txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    return cellDeps.clear();
  });
  config = config || getConfig();
  const secp256k1Config = config.SCRIPTS.SECP256K1_BLAKE160!;
  const secp256k1MultiSigConfig = config.SCRIPTS.SECP256K1_BLAKE160_MULTISIG!;
  txSkeleton = txSkeleton.update('cellDeps', (cellDeps) => {
    return cellDeps.push({
      out_point: { tx_hash: secp256k1Config.TX_HASH, index: secp256k1Config.INDEX },
      dep_type: secp256k1Config.DEP_TYPE,
    }, 
    // {
    //   out_point: { tx_hash: secp256k1MultiSigConfig.TX_HASH, index: secp256k1MultiSigConfig.INDEX },
    //   dep_type: secp256k1MultiSigConfig.DEP_TYPE,
    // }
    );
  });

  return txSkeleton;
}

export function calculateCodeHashByBin(scriptBin: Uint8Array): string {
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
