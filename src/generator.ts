import { TransactionSkeletonType } from "@ckb-lumos/helpers";
import { RPC } from "@ckb-lumos/rpc";
import { Input, Script, OutPoint } from "@ckb-lumos/base";
import { Config } from "@ckb-lumos/config-manager";
import { generateTypeID } from "./typeID";

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
export function generateDeployWithDataTx(options: DeployOptions): Promise<TransactionSkeletonType>;
export function generateDeployWithTypeIdTx(options: DeployOptions): Promise<TransactionSkeletonType>;

interface UpgradeOptions extends DeployOptions {
  typeId: Script;
}
export function generateUpgradeTypeIdDataTx(options: DeployOptions): Promise<TransactionSkeletonType>;

export function compareScriptBinaryWithOnChainData(scriptBinary: Buffer, outPoint: OutPoint, rpc: RPC): Promise<boolean>
