import { ethers } from "hardhat";

/**
 * Deploys all ERC-8004 + x402 contracts and prints addresses.
 * Uses Arc's native USDC at 0x3600000000000000000000000000000000000000.
 * Usage:
 *   npx hardhat run scripts/deploy.ts --network arcTestnet
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Use Arc's native USDC — no deployment needed
  const usdcAddr = process.env.USDC_ADDRESS;
  if (!usdcAddr) throw new Error("USDC_ADDRESS is not set in .env");
  console.log("Using USDC at:", usdcAddr);
  await delay(2000);

  // 1. IdentityRegistry
  const IdentityRegistry = await ethers.getContractFactory("IdentityRegistry");
  const identity = await IdentityRegistry.deploy();
  await identity.waitForDeployment();
  const identityAddr = await identity.getAddress();
  console.log("IdentityRegistry deployed to:", identityAddr);
  await delay(5000);

  // 2. ValidationRegistry
  const ValidationRegistry = await ethers.getContractFactory("ValidationRegistry");
  const validation = await ValidationRegistry.deploy();
  await validation.waitForDeployment();
  const validationAddr = await validation.getAddress();
  console.log("ValidationRegistry deployed to:", validationAddr);
  await delay(5000);

  // 3. ReputationRegistry
  const ReputationRegistry = await ethers.getContractFactory("ReputationRegistry");
  const reputation = await ReputationRegistry.deploy(validationAddr);
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  console.log("ReputationRegistry deployed to:", reputationAddr);
  await delay(5000);

  // 4. PaymentEscrow (uses Arc USDC)
  const PaymentEscrow = await ethers.getContractFactory("PaymentEscrow");
  const escrow = await PaymentEscrow.deploy(usdcAddr);
  await escrow.waitForDeployment();
  const escrowAddr = await escrow.getAddress();
  console.log("PaymentEscrow deployed to:", escrowAddr);
  await delay(5000);

  // 5. ArbitrationRegistry
  const ArbitrationRegistry = await ethers.getContractFactory("ArbitrationRegistry");
  const arbitration = await ArbitrationRegistry.deploy(escrowAddr);
  await arbitration.waitForDeployment();
  const arbitrationAddr = await arbitration.getAddress();
  console.log("ArbitrationRegistry deployed to:", arbitrationAddr);
  await delay(5000);

  // Wire up: PaymentEscrow needs to know the ArbitrationRegistry address
  const setArbTx = await escrow.setArbitrationContract(arbitrationAddr);
  await setArbTx.wait();
  console.log("  PaymentEscrow.setArbitrationContract →", arbitrationAddr);
  await delay(3000);

  // 6. NegotiationManager
  const NegotiationManager = await ethers.getContractFactory("NegotiationManager");
  const negotiation = await NegotiationManager.deploy();
  await negotiation.waitForDeployment();
  const negotiationAddr = await negotiation.getAddress();
  console.log("NegotiationManager deployed to:", negotiationAddr);

  console.log("\n=== Copy to .env ===");
  console.log(`USDC_ADDRESS=${usdcAddr}`);
  console.log(`IDENTITY_REGISTRY_ADDRESS=${identityAddr}`);
  console.log(`REPUTATION_REGISTRY_ADDRESS=${reputationAddr}`);
  console.log(`VALIDATION_REGISTRY_ADDRESS=${validationAddr}`);
  console.log(`PAYMENT_ESCROW_ADDRESS=${escrowAddr}`);
  console.log(`ARBITRATION_REGISTRY_ADDRESS=${arbitrationAddr}`);
  console.log(`NEGOTIATION_MANAGER_ADDRESS=${negotiationAddr}`);

  return { identity, reputation, validation, escrow, arbitration, negotiation };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

export default main;
