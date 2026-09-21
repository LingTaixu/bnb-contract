import { artifacts, network } from "hardhat";

const NETWORK_NAME = "bscTestnet";

async function main() {
  const txHash = process.env.TX_HASH;
  if (!txHash) {
    throw new Error(
      "请通过环境变量 TX_HASH 提供交易哈希，例如：\n" +
        "  TX_HASH=0x... npx hardhat run scripts/query.ts",
    );
  }

  const { ethers } = await network.create(NETWORK_NAME);
  const receipt = await ethers.provider.getTransactionReceipt(txHash);
  if (receipt === null) {
    console.log("未找到该交易:", txHash);
    process.exitCode = 1;
    return;
  }

  const artifact = await artifacts.readArtifact("DataNotary");
  const iface = new ethers.Interface(artifact.abi);

  let found = false;
  for (const log of receipt.logs) {
    let parsed;
    try {
      parsed = iface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name !== "Stored") continue;

    found = true;
    const data = parsed.args.data as string;
    console.log("交易哈希:", receipt.hash);
    console.log("区块号:", receipt.blockNumber);
    console.log("时间戳:", parsed.args.timestamp.toString());
    console.log("数据(hex):", data);
    console.log("数据(UTF-8):", ethers.toUtf8String(data));
  }

  if (!found) {
    console.log("该交易中未找到 DataNotary 的 Stored 存证事件:", txHash);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
