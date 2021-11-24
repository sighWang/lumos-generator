import { CellProvider, HashType } from "@ckb-lumos/base";
import { Indexer } from "@ckb-lumos/ckb-indexer";
import { generateUpgradeTypeIdDataTx } from "./generator";

const CKB_RPC_URL = "https://testnet.ckb.dev/rpc";
const CKB_INDEXER_URL = "https://testnet.ckb.dev/indexer";
const indexer = new Indexer(CKB_INDEXER_URL, CKB_RPC_URL);
const lock = {
    code_hash:
      "0x9bd7e06f3ecf4be0f2fcd2188b23f1b9fcc88e5d4b65a8637b17723bbda3cce8",
    hash_type: "type" as HashType,
    args: "0xa528f2b9a51118b193178db4cf2f3db92e7df323",
  };
  const test = async () => {
    const optUpgrade = {
        cellProvider: indexer,
        fromLock: lock,
        scriptBinary: Uint8Array.of(1, 2, 3) as Buffer,
        typeId: {
          code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
          hash_type: "type" as const,
          args: '0xe9451f3528af55247ff7d3851a00b54a5fe7de38d40dc29580ce2c069332633a'
        }
      }
    
      let upgradeTxSkeleton = await generateUpgradeTypeIdDataTx(optUpgrade);
  }

test()
