# DataNotary 后端调用文档

> 本文件面向 **后端开发者** 与 **LLM 代码生成**。所有事实均为可直接引用的确定值，代码示例可直接复制运行。

---

## 0. Quick Facts（机器可读事实表）

| 键 | 值 |
|---|---|
| `contract.name` | `DataNotary` |
| `contract.address` | `0x3211E60F2D10a200362795C580097A4f9bbc6DdA` |
| `chain.name` | BSC Testnet（币安智能链测试网） |
| `chain.chainId` | `97` |
| `chain.chainIdHex` | `0x61` |
| `rpc.url` | `https://data-seed-prebsc-1-s1.binance.org:8545/` |
| `rpc.fallbackUrls` | `https://data-seed-prebsc-2-s2.binance.org:8545/`、`https://bsc-testnet-rpc.publicnode.com`、`https://bsc-testnet.bnbchain.org` |
| `contract.stateful` | `false`（无状态，不保存任何 storage） |
| `contract.owned` | `false`（无 owner，无权限门槛） |
| `maxDataBytes` | `64` |
| `writeFunction.signature` | `store(bytes)` |
| `writeFunction.selector` | `0xb374012b` |
| `writeFunction.mutability` | `nonpayable`（需付 gas） |
| `event.signature` | `Stored(uint256,bytes)` |
| `event.topic0` | `0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f` |
| `event.timestampIndexed` | `true`（时间戳在 `topics[1]`） |
| `event.dataIndexed` | `false`（原始字节在 `log.data`） |
| `error.emptyData` | `DataNotary: empty data` |
| `error.dataTooLarge` | `DataNotary: data too large` |

---

## 1. 概述

`DataNotary` 是一个**链上存证合约**：调用方把一段不超过 64 字节的数据（典型用途：IPv4/IPv6 文本）写入合约，合约将其放入**事件日志（event log）**并附上链上时间戳。合约本身不保存任何状态。

后端与合约之间只有**两条路径**，方向完全不同：

```
                       后端 <-> DataNotary
                              |
          +-------------------+-------------------+
          |                                       |
   [写入路径] 存证                          [读取路径] 回查
   需要私钥 + gas，改变链上数据              只读，无需私钥，无 gas
          |                                       |
   后端签名交易 -> RPC                        后端发 JSON-RPC -> RPC
        <- txHash -                             <- logs.data(原始字节) -
   把 txHash 存入数据库                          本地解码
```

**核心设计（务必理解）：**

1. **写入必须签名**。交易签名无法用纯 `curl` 手工完成（需 RLP 编码 + secp256k1 签名），因此写入路径必须使用某个链库（ethers / web3.py / web3j / ethclient 等）。
2. **读取无需任何库**。任意语言用一次 HTTP POST（`eth_getTransactionReceipt`）即可拿回原始字节。
3. **数据库只存 txHash 作为指针**，原始字节始终可从链上取回。

---

## 2. 合约接口

### 2.1 ABI

```json
[
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "uint256", "name": "timestamp", "type": "uint256" },
      { "indexed": false, "internalType": "bytes", "name": "data", "type": "bytes" }
    ],
    "name": "Stored",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "MAX_DATA_LENGTH",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "bytes", "name": "data", "type": "bytes" }],
    "name": "store",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
]
```

### 2.2 写入函数 `store(bytes)`

| 项目 | 值 |
|---|---|
| 选择器 | `0xb374012b` |
| 参数 | `data`：`bytes`，长度必须 `> 0` 且 `<= 64` |
| 返回值 | 无 |
| 副作用 | 发出 `Stored` 事件；不写 storage |
| 失败 | 越界则 revert，见 2.4 |

### 2.3 事件 `Stored(uint256 indexed timestamp, bytes data)`

| 位置 | 内容 |
|---|---|
| `topics[0]` | `0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f` |
| `topics[1]` | `timestamp`（`uint256`，链上区块时间，无法伪造） |
| `data` | ABI 编码的 `bytes`：`offset(32B) | length(32B) | payload(补齐到 32B 边界)` |

### 2.4 错误（revert 原因）

| 条件 | revert 字符串 | 十六进制（编码后） |
|---|---|---|
| `data.length == 0` | `DataNotary: empty data` | — |
| `data.length > 64` | `DataNotary: data too large` | — |

### 2.5 常量

- `MAX_DATA_LENGTH()` → `64`（`view`，可 `eth_call` 读取）

---

## 3. 写入路径 A：后端发交易（存证）

### 3.1 固定流程

```
1. 后端持有热钱包私钥（放环境变量 / 密钥管理服务）
2. 构造并签名交易：to = 合约地址，data = ABI 编码的 store(bytes)
3. 发送 eth_sendRawTransaction
4. 等待回执，获得 txHash
5. 将 txHash 写入数据库（主键）
```

### 3.2 Node / TypeScript（ethers v6，推荐）

```ts
import { JsonRpcProvider, Wallet, Contract, Interface } from "ethers";

const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/";
const CONTRACT_ADDRESS = "0x3211E60F2D10a200362795C580097A4f9bbc6DdA";
const ABI = [
  "function store(bytes)",
  "event Stored(uint256 indexed timestamp, bytes data)",
];

const provider = new JsonRpcProvider(RPC, 97);
const wallet = new Wallet(process.env.PRIVATE_KEY!, provider); // 热钱包
const notary = new Contract(CONTRACT_ADDRESS, ABI, wallet);

export async function notarize(ip: string): Promise<{
  txHash: string;
  timestamp: number;
  data: string;
}> {
  const bytes = new TextEncoder().encode(ip);
  if (bytes.length === 0) throw new Error("empty data");
  if (bytes.length > 64) throw new Error("data too large");

  const tx = await notary.store(bytes);
  const receipt = await tx.wait(1); // 等 1 个确认
  if (!receipt || receipt.status !== 1) throw new Error("tx failed");

  const iface = new Interface(ABI);
  for (const log of receipt.logs) {
    const parsed = iface.parseLog(log);
    if (parsed?.name === "Stored") {
      return {
        txHash: receipt.hash,
        timestamp: Number(parsed.args.timestamp),
        data: Buffer.from(parsed.args.data.slice(2), "hex").toString("utf8"),
      };
    }
  }
  throw new Error("Stored event not found");
}
```

### 3.3 Python（web3.py）

```python
import os
from web3 import Web3

RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/"
CONTRACT_ADDRESS = "0x3211E60F2D10a200362795C580097A4f9bbc6DdA"
ABI = [
    {"inputs": [{"internalType": "bytes", "name": "data", "type": "bytes"}],
     "name": "store", "outputs": [], "stateMutability": "nonpayable", "type": "function"},
    {"anonymous": False,
     "inputs": [{"indexed": True, "internalType": "uint256", "name": "timestamp", "type": "uint256"},
                {"indexed": False, "internalType": "bytes", "name": "data", "type": "bytes"}],
     "name": "Stored", "type": "event"},
]

w3 = Web3(Web3.HTTPProvider(RPC))
acct = w3.eth.account.from_key(os.environ["PRIVATE_KEY"])
contract = w3.eth.contract(address=CONTRACT_ADDRESS, abi=ABI)

def notarize(ip: str) -> str:
    data = ip.encode("utf-8")
    assert 0 < len(data) <= 64, "data length must be in (0, 64]"
    tx = contract.functions.store(data).build_transaction({
        "chainId": 97,
        "nonce": w3.eth.get_transaction_count(acct.address),
        "gas": 100_000,
        "gasPrice": w3.eth.gas_price,
    })
    signed = acct.sign_transaction(tx)
    tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
    assert receipt.status == 1, "tx failed"
    return tx_hash.hex()
```

### 3.4 原始 calldata（任意语言，仅供理解 / 非主流语言使用）

存证 `"192.168.1.1"` 的完整交易 `data` 字段（100 字节）：

```
0xb374012b
0000000000000000000000000000000000000000000000000000000000000020
000000000000000000000000000000000000000000000000000000000000000b
3139322e3136382e312e31000000000000000000000000000000000000000000
```

拆解：

```
0xb374012b                store(bytes) 选择器
...0020                   offset = 32（bytes 内容起始位置）
...000b                   length = 11（"192.168.1.1" 的字节数）
3139322e...0000           payload，右侧补 0 到 32 字节边界
```

> 若你的语言没有链库，仍需自行完成 nonce、gas、RLP 编码与 EIP-155 签名后再 `eth_sendRawTransaction`。不建议在主流语言中这样做。

---

## 4. 读取路径 B：按 txHash 回查（只读）

### 4.1 请求（原始 JSON-RPC，任何语言可用）

```http
POST https://data-seed-prebsc-1-s1.binance.org:8545/
Content-Type: application/json

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "eth_getTransactionReceipt",
  "params": ["0x<你的 txHash>"]
}
```

### 4.2 响应结构（只保留关键字段）

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "status": "0x1",
    "to": "0x3211e60f2d10a200362795c580097a4f9bbc6dda",
    "blockNumber": "0x7e28a15",
    "logs": [
      {
        "address": "0x3211e60f2d10a200362795c580097a4f9bbc6dda",
        "topics": [
          "0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f",
          "0x000000000000000000000000000000000000000000000000000000006ab0de05"
        ],
        "data": "0x0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b3139322e3136382e312e31000000000000000000000000000000000000000000"
      }
    ]
  }
}
```

判定规则（LLM 生成代码时遵循）：

1. `result == null` → 交易不存在，返回「未找到」。
2. `result.status != "0x1"` → 交易失败。
3. 遍历 `result.logs`，仅处理 `topics[0] === event.topic0` 的日志。
4. 若没有任何匹配日志 → 该交易不含存证，返回「未找到」。
5. 解码见 4.3。

### 4.3 解码 `log.data`

```
data = 0x
  [0:64]    offset  = 32（十六进制 0x20）      内容起始字节位置
  [64:128]  length  = 11（十六进制 0x0b）      payload 字节数
  [128:128+length*2]  payload = "3139322e3136382e312e31" -> "192.168.1.1"
```

`timestamp` 从 `topics[1]` 直接解析：`parseInt(topics[1], 16)` → `1789976069`。

### 4.4 解码代码

**Node / TypeScript（纯 fetch，无需链库）：**

```ts
const EVENT_TOPIC0 =
  "0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f";

export async function queryByTxHash(txHash: string): Promise<
  { timestamp: number; data: string } | null
> {
  const res = await fetch("https://data-seed-prebsc-1-s1.binance.org:8545/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getTransactionReceipt",
      params: [txHash],
    }),
  });
  const { result } = await res.json();
  if (!result || result.status !== "0x1") return null;

  for (const log of result.logs) {
    if (log.topics[0]?.toLowerCase() !== EVENT_TOPIC0) continue;
    const h = log.data.slice(2);
    const len = parseInt(h.slice(64, 128), 16);
    const payload = h.slice(128, 128 + len * 2);
    return {
      timestamp: parseInt(log.topics[1], 16),
      data: Buffer.from(payload, "hex").toString("utf8"),
    };
  }
  return null;
}
```

**Python：**

```python
import requests

EVENT_TOPIC0 = "0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f"

def query_by_tx_hash(tx_hash: str):
    res = requests.post(
        "https://data-seed-prebsc-1-s1.binance.org:8545/",
        json={"jsonrpc": "2.0", "id": 1,
              "method": "eth_getTransactionReceipt", "params": [tx_hash]},
        timeout=15,
    )
    result = res.json().get("result")
    if not result or result.get("status") != "0x1":
        return None
    for log in result["logs"]:
        if log["topics"][0].lower() != EVENT_TOPIC0:
            continue
        h = log["data"][2:]
        length = int(h[64:128], 16)
        payload = h[128:128 + length * 2]
        return {
            "timestamp": int(log["topics"][1], 16),
            "data": bytes.fromhex(payload).decode("utf-8"),
        }
    return None
```

---

## 5. 数据流与数据库设计

```
用户/业务 -> 后端 -> store() 交易 -> 链上 Stored 事件
                 |
                 +-> txHash 存入数据库（主键）

需要原文时 -> 用 txHash -> eth_getTransactionReceipt -> 解码 -> 原文
```

建议的表结构（示意，字段按业务增减）：

| 列 | 类型 | 说明 |
|---|---|---|
| `tx_hash` | `CHAR(66)` PRIMARY KEY | 链上交易哈希，唯一检索键 |
| `ip` | `VARCHAR(64)` | 明文 IP（便于本地快速查询，可选） |
| `block_number` | `BIGINT` | 区块号，可选 |
| `notarized_at` | `TIMESTAMP` | 链上时间戳（由事件提供），可选 |
| `created_at` | `TIMESTAMP` | 入库时间 |

**要点：**

- 链上事件是**权威来源**；数据库只是索引。若二者不一致，以链上为准。
- 若希望本地能直接搜 IP，可冗余存 `ip` 字段；但这会削弱链上数据的隐私优势（见 §6）。
- 也可只存 `tx_hash`，回查时再解码。

---

## 6. 私钥与安全

| 风险 | 措施 |
|---|---|
| 私钥泄露 | 私钥仅存于环境变量或密钥管理服务（KMS/Vault），**绝不写入代码或数据库** |
| 私钥入库 git | `.env` 已列入 `.gitignore`；CI 中通过 secret 注入 |
| 热钱包余额耗尽 | 监控余额，低于阈值告警 |
| 数据隐私 | 链上字节是**公开可读**的。IP 明文上链后任何人有 txHash 都能读到。若需隐私，应改为「哈希 + 盐」方案（需另立变更） |
| 恶意刷量 | 合约无权限门槛、无 gas 返还，任何人都可存证。若需限制，需在合约层加白名单（当前不支持） |

---

## 7. nonce / gas / 确认策略

| 主题 | 建议 |
|---|---|
| nonce | 同一热钱包**串行发交易**（队列），或使用 `pending` nonce 计数器。并发直接用 `getTransactionCount` 会 nonce 冲突 |
| gas limit | 存证调用约 5 万 gas 以内；可设 `100_000` 上限，多余会退回 |
| gas price | BSC 测试网用 `eth_gasPrice` 即可 |
| 确认数 | 入库前建议 `wait(1)`；若追求吞吐，可先入库 `pending`，回执后再更新状态 |
| 重试 | 交易卡住时用相同 nonce 加价替换（replace-by-fee），不要重复发新 nonce |

---

## 8. 错误处理

| 场景 | 表现 | 处理 |
|---|---|---|
| 空数据 | revert `DataNotary: empty data` | 后端预校验长度，避免浪费 gas |
| 超过 64 字节 | revert `DataNotary: data too large` | 后端预校验长度 |
| 交易失败 | receipt `status = 0x0` | 不写数据库，记录日志 |
| 余额不足 | `insufficient funds` | 告警充值 |
| txHash 查不到 | `result == null` | 返回「未找到」 |
| 无存证事件 | `logs` 无匹配 `topic0` | 返回「未找到」 |

> 后端应在**发交易前**校验 `0 < bytes.length <= 64`，把可预见的 revert 挡在链下。

---

## 9. 完整端到端示例（Node）

```ts
import { JsonRpcProvider, Wallet, Contract, Interface } from "ethers";

const RPC = "https://data-seed-prebsc-1-s1.binance.org:8545/";
const CONTRACT_ADDRESS = "0x3211E60F2D10a200362795C580097A4f9bbc6DdA";
const EVENT_TOPIC0 = "0x541e3f905dc106b00597232a3f1cc4a6ee78c15301e6f25f66456fdc42ddc62f";
const ABI = ["function store(bytes)", "event Stored(uint256 indexed timestamp, bytes data)"];

const provider = new JsonRpcProvider(RPC, 97);
const wallet = new Wallet(process.env.PRIVATE_KEY!, provider);
const notary = new Contract(CONTRACT_ADDRESS, ABI, wallet);

// 1) 存证，返回并持久化 txHash
async function notarize(ip: string) {
  const bytes = new TextEncoder().encode(ip);
  if (bytes.length === 0 || bytes.length > 64) throw new Error("invalid length");
  const tx = await notary.store(bytes);
  const receipt = await tx.wait(1);
  if (!receipt || receipt.status !== 1) throw new Error("tx failed");
  return receipt.hash; // -> 存入数据库
}

// 2) 用 txHash 回查
async function query(txHash: string) {
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt || receipt.status !== 1) return null;
  const iface = new Interface(ABI);
  for (const log of receipt.logs) {
    if (log.topics[0].toLowerCase() !== EVENT_TOPIC0) continue;
    const parsed = iface.parseLog(log);
    if (parsed?.name === "Stored") {
      return {
        timestamp: Number(parsed.args.timestamp),
        data: Buffer.from(parsed.args.data.slice(2), "hex").toString("utf8"),
      };
    }
  }
  return null;
}

// 使用
const txHash = await notarize("192.168.1.1");
console.log(await query(txHash)); // { timestamp: 1789976069, data: "192.168.1.1" }
```

---

## 10. 真实链上参考数据（已在 BSC 测试网验证）

| 项目 | 值 |
|---|---|
| 合约地址 | `0x3211E60F2D10a200362795C580097A4f9bbc6DdA` |
| 部署交易 | `0x16cc8371b35afda8bde38634fed52edec6e5bc5905fde7c43d68adec536a1138` |
| 部署账户 | `0x73255cF9030a0d6001E521BD0F11D6c1EFEf2670` |
| 存证交易 | `0x9a2376b2b02867719e5a2b17c4f43348fc231daa544185c3f764a4f49d7c19d4` |
| 存入内容 | `192.168.1.1`（hex：`0x3139322e3136382e312e31`） |
| 区块号 | `132286997` |
| 链上时间戳 | `1789976069` |
| 回查结果 | `192.168.1.1`（与存入一致） |

验证命令（只读）：

```bash
curl -s -X POST "https://data-seed-prebsc-1-s1.binance.org:8545/" \
  -H 'content-type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["0x9a2376b2b02867719e5a2b17c4f43348fc231daa544185c3f764a4f49d7c19d4"]}'
```

---

## 11. FAQ

**Q：后端能不能不装 ethers，只用 HTTP 调用？**
A：读取可以；写入不行（需签名）。写入至少需要一个能签名的库。

**Q：合约会保存数据吗？**
A：不会。数据只在事件日志里，合约无 storage、无状态。

**Q：一个 txHash 能存多条数据吗？**
A：不能。一次 `store` 调用 = 一条数据 = 一个 txHash。批量存证需多次调用（多笔交易）。

**Q：如何知道数据有没有被篡改？**
A：事件日志随区块永久保存且不可修改。只要 txHash 对应的区块还在，数据就不可篡改。可自行核对返回字节与业务原始值。

**Q：能按合约地址批量查所有存证吗？**
A：当前设计只按 txHash 查。若要按合约批量拉取，可用 `eth_getLogs`（按 `address` + `topics[0]` 过滤），但需自行处理分页与区块范围，且合约未使用 `indexed` 业务键。

**Q：合约在 BSCScan 上验证了吗？**
A：未验证。如需在浏览器上阅读/交互，可运行 `npx hardhat verify --network bscTestnet <address>`（需配置 BSCScan API key）。

---

## 附录：部署与脚本（本仓库）

```bash
# 安装依赖
bun install

# 编译
npx hardhat build

# 测试
npx hardhat test

# 部署（读取 .env 的 PRIVATE_KEY）
npx hardhat run scripts/deploy.ts

# 存证
CONTRACT_ADDRESS=0x3211E60F2D10a200362795C580097A4f9bbc6DdA IP=192.168.1.1 \
  npx hardhat run scripts/store.ts

# 回查
TX_HASH=0x... npx hardhat run scripts/query.ts
```

相关文件：

| 文件 | 作用 |
|---|---|
| `contracts/DataNotary.sol` | 合约源码 |
| `scripts/deploy.ts` | 部署脚本 |
| `scripts/store.ts` | 存证脚本 |
| `scripts/query.ts` | 按 txHash 回查脚本 |
| `test/DataNotary.test.ts` | 单元测试 |
| `hardhat.config.ts` | Hardhat 配置（bscTestnet / chainId 97） |
