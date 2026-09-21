import { artifacts } from "hardhat";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

async function main() {
  const contractName = process.env.CONTRACT ?? "DataNotary";
  const outPath = resolve(process.env.ABI_OUT ?? `abi/${contractName}.json`);

  const artifact = await artifacts.readArtifact(contractName);

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2) + "\n");

  console.log(`已导出 ${contractName} 的 ABI -> ${outPath}`);
  console.log(`条目数: ${artifact.abi.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
