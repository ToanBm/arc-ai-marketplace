import { ethers } from "hardhat";

/**
 * Redeploys only PaymentEscrow + ArbitrationRegistry against Arc's native USDC.
 * Preserves existing IdentityRegistry, ReputationRegistry, ValidationRegistry, NegotiationManager.
 *
 * Usage:
 *   npx hardhat run scripts/redeploy-escrow.ts --network arcTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Redeploying PaymentEscrow + ArbitrationRegistry with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const usdcAddr = process.env.USDC_ADDRESS || "0x3600000000000000000000000000000000000000";
  console.log("Using USDC:", usdcAddr);

  // 1. PaymentEscrow (with Arc USDC)
  const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
  const escrow = await PaymentEscrow.deploy(usdcAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("PaymentEscrow deployed to:", escrowAddr);
  await delay(5000);

  // 2. ArbitrationRegistry (depends on new escrow)
  const ArbitrationRegistry = await ethers.getContractFactory("ArbitrationRegistry");
  const arbitration = await ArbitrationRegistry.deploy(escrowAddr);
  await arbitration.waitForDeployment();
  const arbitrationAddr = await arbitration.getAddress();
  console.log("ArbitrationRegistry deployed to:", arbitrationAddr);
  await delay(5000);

  // 3. Wire up
  const setArbTx = await escrow.setArbitrationContract(arbitrationAddr);
  await setArbTx.wait();
  console.log("  PaymentEscrow.setArbitrationContract →", arbitrationAddr);

  console.log("\n=== Update these in .env ===");
  console.log(`PAYMENT_ESCROW_ADDRESS=${escrowAddr}`);
  console.log(`ARBITRATION_REGISTRY_ADDRESS=${arbitrationAddr}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
