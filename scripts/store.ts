import { network } from "hardhat";

const NETWORK_NAME = "bscTestnet";

async function main() {
  const address = process.env.CONTRACT_ADDRESS;
  const ip = process.env.IP;

  if (!address) {
    throw new Error("请通过环境变量 CONTRACT_ADDRESS 提供已部署的合约地址");
  }
  if (!ip) {
    throw new Error("请通过环境变量 IP 提供要存证的 IP 文本");
  }

  const { ethers } = await network.create(NETWORK_NAME);
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("请在 .env 中填写 PRIVATE_KEY（需含 BSC 测试网 BNB）。");
  }

  const data = ethers.toUtf8Bytes(ip);
  if (data.length === 0) {
    throw new Error("IP 文本为空");
  }
  if (data.length > 64) {
    throw new Error(`IP 文本为 ${data.length} 字节，超过 64 字节上限`);
  }

  const notary = await ethers.getContractAt("DataNotary", address, signers[0]!);
  const tx = await notary.store(data);
  console.log("存证交易:", tx.hash);

  const receipt = await tx.wait();
  console.log("状态:", receipt?.status === 1 ? "success" : "unknown");
  console.log("请将该 txHash 存入数据库作为检索键:", tx.hash);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
