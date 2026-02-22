import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY_A = process.env.PRIVATE_KEY_AGENT_A || "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"; // Hardhat default #0
const PRIVATE_KEY_B = process.env.PRIVATE_KEY_AGENT_B || "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // Hardhat default #1
const PRIVATE_KEY_C = process.env.PRIVATE_KEY_AGENT_C || "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a"; // Hardhat default #2
const PRIVATE_KEY_D = process.env.PRIVATE_KEY_AGENT_D || "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6"; // Hardhat default #3
const PRIVATE_KEY_E = process.env.PRIVATE_KEY_AGENT_E || "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"; // Hardhat default #4
const PRIVATE_KEY_F = process.env.PRIVATE_KEY_AGENT_F || "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"; // Hardhat default #5
const PRIVATE_KEY_MARKETPLACE = process.env.PRIVATE_KEY_MARKETPLACE || "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e"; // Hardhat default #6

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    arcTestnet: {
      url: process.env.ARC_RPC_URL || "https://5042002.rpc.thirdweb.com",
      chainId: 5042002,
      accounts: [PRIVATE_KEY_A, PRIVATE_KEY_B, PRIVATE_KEY_C, PRIVATE_KEY_D, PRIVATE_KEY_E, PRIVATE_KEY_F, PRIVATE_KEY_MARKETPLACE],
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
