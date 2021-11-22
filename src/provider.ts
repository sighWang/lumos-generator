import { QueryOptions, Script, Hexadecimal, CellCollectorResults, Tip } from '@ckb-lumos/base';
import axios from "axios";

enum ScriptType {
  type = "type",
  lock = "lock",
}

type HexadecimalRange = [Hexadecimal, Hexadecimal];

interface SearchKey {
  script: Script;
  script_type: ScriptType;
  filter?: {
    script?: Script;
    output_data_len_range?: HexadecimalRange;
    output_capacity_range?: HexadecimalRange;
    block_range?: HexadecimalRange;
  };
}

async function request(
  method: string,
  params?: any,
  ckbIndexerUrl: string = 'https://testnet.ckb.dev/indexer',
): Promise<any> {
  const data = {
    id: 0,
    jsonrpc: "2.0",
    method,
    params,
  };
  const res = await axios.post(ckbIndexerUrl, data);
  if (res.status !== 200) {
    throw new Error(`indexer request failed with HTTP code ${res.status}`);
  }
  if (res.data.error !== undefined) {
    throw new Error(
      `indexer request rpc failed with error: ${JSON.stringify(
        res.data.error
      )}`
    );
  }
  return res.data.result;
}

export class Provider {
  collector(queries: QueryOptions) {
    const { lock, type } = queries;
    let searchKey: SearchKey;
    if (lock !== undefined) {
      searchKey = {
        script: lock as Script,
        script_type: ScriptType.lock,
      };
      if (type != undefined && type !== "empty") {
        searchKey.filter = {
          script: type as Script,
        };
      }
    } else {
      if (type != undefined && type != "empty") {
        searchKey = {
          script: type as Script,
          script_type: ScriptType.type,
        };
      } else {
        throw new Error(
          `should specify either type or lock in queries, queries now: ${JSON.stringify(
            queries,
            null,
            2
          )}`
        );
      }
    }
    // const queryData = queries.data || "0x";
    return {
      collect(): CellCollectorResults {
        return {
          async *[Symbol.asyncIterator]() {
            const order = "asc";
            const sizeLimit = 100;
            let cursor = null;
            for (;;) {
              const params = [
                searchKey,
                order,
                `0x${sizeLimit.toString(16)}`,
                cursor,
              ];

              const res = await request('get_cells', params);
              const liveCells = res.objects;
              cursor = res.last_cursor;
              for (const cell of liveCells) {
                // if (queryData === "any" || queryData === cell.output_data) {
                  yield {
                    cell_output: cell.output,
                    data: cell.output_data,
                    out_point: cell.out_point,
                    block_number: cell.block_number,
                  };
                // }
              }
              if (liveCells.length < sizeLimit) {
                break;
              }
            }
          },
        };
      },
    };
  }

  async get_tip(): Promise<Tip> {
    const res = await request("get_tip");
    return res as Tip;
  }
}