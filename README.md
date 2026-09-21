# bnb-contract

基于 Hardhat 的 BSC 测试网（chainId 97）链上存证合约。将不超过 64 字节的数据
（如 IPv4/IPv6 文本）写入事件日志，合约无状态、无所有权、任何地址可调用。
数据只存在于事件日志中，之后可用交易哈希（txHash）经公开 RPC 回查。

## 安装

```bash
bun install
```

## 配置

复制/编辑 `.env`，填入部署账户私钥（需含 BSC 测试网 BNB）：

```
PRIVATE_KEY=0x...
```

`.env` 已被 `.gitignore` 忽略，不会进入版本库。

## 编译与测试

```bash
npx hardhat build
npx hardhat test
```

## 部署到 BSC 测试网

```bash
npx hardhat run scripts/deploy.ts
```

脚本会向 `bscTestnet` 部署 `DataNotary` 并打印合约地址。

## 存证与回查

### 1. 存证一段数据（如 IP）

```bash
CONTRACT_ADDRESS=0x<合约地址> IP=192.168.1.1 npx hardhat run scripts/store.ts
```

输出中的 `txHash` 即为本次存证的上链凭证。

### 2. 将 txHash 存入数据库作为检索键

存证流程是「链上存字节，链下存指针」：

```
store(data) ──> txHash ──> 数据库(主键=txHash, 可附带业务字段)
                              │
需要原文时: TX_HASH=0x... ────┘
```

把 `txHash` 作为数据库主键保存（可另存 IP、时间、用户等业务字段以便快速检索）。
数据库只是索引，真正的原始字节始终可从链上取回。

### 3. 用 txHash 从 RPC 回查原始字节

```bash
TX_HASH=0x<存证交易哈希> npx hardhat run scripts/query.ts
```

脚本调用 `eth_getTransactionReceipt`，解析 `DataNotary` 的 `Stored` 事件，
打印原始字节（hex 与 UTF-8）和链上时间戳。若该交易无对应存证事件则退出码非 0。

## 合约接口

```solidity
event Stored(uint256 indexed timestamp, bytes data);

function store(bytes calldata data) external;
```

- `data` 长度须在 `(0, 64]` 之间，越界回滚。
- `timestamp` 取自链上 `block.timestamp`，调用方无法伪造。
- 合约不保存任何状态，数据仅存于事件日志。
