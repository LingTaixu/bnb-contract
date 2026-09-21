import { network } from "hardhat";

const NETWORK_NAME = "bscTestnet";

async function main() {
  const { ethers } = await network.create(NETWORK_NAME);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error(
      "未找到可用账户：请在 .env 中填写 PRIVATE_KEY（需含 BSC 测试网 BNB）。",
    );
  }
  const deployer = signers[0]!;

  console.log("网络:", NETWORK_NAME);
  console.log("部署账户:", deployer.address);

  const notary = await ethers.deployContract("DataNotary");
  const deployTx = notary.deploymentTransaction();
  console.log("部署交易:", deployTx?.hash);

  await notary.waitForDeployment();
  const address = await notary.getAddress();
  const receipt = deployTx ? await deployTx.wait() : null;

  console.log("合约地址:", address);
  console.log("交易状态:", receipt?.status === 1 ? "success" : "unknown");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
