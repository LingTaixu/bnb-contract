import { expect } from "chai";
import { network } from "hardhat";
import { describe, it } from "mocha";

describe("DataNotary", function () {
  async function deployFixture() {
    const { ethers } = await network.create();
    const notary = await ethers.deployContract("DataNotary");
    await notary.waitForDeployment();
    return { ethers, notary };
  }

  it("接受合法长度数据并发出含数据与链上时间戳的事件", async function () {
    const { ethers, notary } = await deployFixture();
    const data = ethers.toUtf8Bytes("192.168.1.1");

    const tx = await notary.store(data);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);

    const parsed = receipt!.logs.map((log) => notary.interface.parseLog(log));
    expect(parsed).to.have.lengthOf(1);
    expect(parsed[0]!.name).to.equal("Stored");
    expect(parsed[0]!.args.data).to.equal(ethers.hexlify(data));
    expect(parsed[0]!.args.timestamp).to.equal(block!.timestamp);
  });

  it("接受 IPv6 文本（在 64 字节以内）", async function () {
    const { ethers, notary } = await deployFixture();
    const data = ethers.toUtf8Bytes("2001:0db8:85a3::8a2e:0370:7334");
    expect(data.length).to.be.at.most(64);

    await expect(notary.store(data)).to.emit(notary, "Stored");
  });

  it("拒绝空数据", async function () {
    const { notary } = await deployFixture();
    await expect(notary.store("0x")).to.be.revertedWith(
      "DataNotary: empty data",
    );
  });

  it("拒绝超过 64 字节的数据", async function () {
    const { ethers, notary } = await deployFixture();
    const data = ethers.toUtf8Bytes("x".repeat(65));

    await expect(notary.store(data)).to.be.revertedWith(
      "DataNotary: data too large",
    );
  });

  it("任意地址均可存证（无权限门槛）", async function () {
    const { ethers, notary } = await deployFixture();
    const [, stranger] = await ethers.getSigners();
    const data = ethers.toUtf8Bytes("10.0.0.1");

    await expect(notary.connect(stranger).store(data)).to.emit(
      notary,
      "Stored",
    );
  });

  it("可用 txHash 从回执中解析出原始字节与时间戳", async function () {
    const { ethers, notary } = await deployFixture();
    const ip = "2001:db8::1";
    const data = ethers.toUtf8Bytes(ip);

    const tx = await notary.store(data);
    const txHash = tx.hash;

    const receipt = await ethers.provider.getTransactionReceipt(txHash);
    expect(receipt).to.not.equal(null);

    let recovered: string | null = null;
    for (const log of receipt!.logs) {
      const parsed = notary.interface.parseLog(log);
      if (parsed?.name === "Stored") {
        recovered = ethers.toUtf8String(parsed.args.data);
      }
    }

    expect(recovered).to.equal(ip);
  });
});
