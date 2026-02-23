import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const PRIVATE_KEY_DEPLOYER    = process.env.PRIVATE_KEY_DEPLOYER    || "";
const PRIVATE_KEY_B           = process.env.PRIVATE_KEY_AGENT_B     || "";
const PRIVATE_KEY_C           = process.env.PRIVATE_KEY_AGENT_C     || "";
const PRIVATE_KEY_D           = process.env.PRIVATE_KEY_AGENT_D     || "";
const PRIVATE_KEY_E           = process.env.PRIVATE_KEY_AGENT_E     || "";
const PRIVATE_KEY_F           = process.env.PRIVATE_KEY_AGENT_F     || "";
const PRIVATE_KEY_TREASURY    = process.env.PRIVATE_KEY_TREASURY     || "";

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
      accounts: [PRIVATE_KEY_DEPLOYER, PRIVATE_KEY_B, PRIVATE_KEY_C, PRIVATE_KEY_D, PRIVATE_KEY_E, PRIVATE_KEY_F, PRIVATE_KEY_TREASURY],
    },
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
