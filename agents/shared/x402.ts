/**
 * x402 Protocol Implementation
 *
 * Implements the HTTP 402 Payment Required micropayment protocol:
 *
 * 1. Client requests a paid resource → Server responds 402 with payment details
 * 2. Client pays on-chain (USDC via PaymentEscrow)
 * 3. Client re-requests with signed payment proof header
 * 4. Server verifies signature and payment on-chain, then delivers the resource
 *
 * Headers used:
 *   X-402-Payment-Required: JSON with {taskId, payee, amount, escrowAddress}
 *   X-402-Payment-Proof:    JSON with {taskId, txHash, payer, signature}
 *
 * Security: the payer signs keccak256(taskId, txHash) with their private key.
 * The server recovers the signer address and verifies it matches the payer.
 */

import { ethers } from "ethers";

export interface X402PaymentRequest {
  taskId: string;
  payee: string;
  amount: string;         // USDC amount in smallest unit (6 decimals)
  escrowAddress: string;
  usdcAddress: string;
  network: string;
  description: string;
}

export interface X402PaymentProof {
  taskId: string;
  txHash: string;
  payer: string;
  signature: string;      // EIP-191 signature of keccak256(taskId, txHash)
}

/**
 * Build the 402 response payload that a provider agent sends to the Marketplace Client.
 */
export function buildPaymentRequest(params: {
  taskId: string;
  payee: string;
  amount: bigint;
  escrowAddress: string;
  usdcAddress: string;
}): X402PaymentRequest {
  return {
    taskId: params.taskId,
    payee: params.payee,
    amount: params.amount.toString(),
    escrowAddress: params.escrowAddress,
    usdcAddress: params.usdcAddress,
    network: "arc-testnet-5042002",
    description: "x402 micropayment for oracle data service",
  };
}

/**
 * Build a signed payment proof that the Marketplace Client sends after paying on-chain.
 * The payer signs keccak256(taskId, txHash) to prove ownership of the payer address.
 */
export async function buildPaymentProof(params: {
  taskId: string;
  txHash: string;
  payer: string;
  wallet: ethers.Wallet;
}): Promise<X402PaymentProof> {
  const messageHash = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32"],
    [params.taskId, params.txHash]
  );
  const signature = await params.wallet.signMessage(ethers.getBytes(messageHash));

  return {
    taskId: params.taskId,
    txHash: params.txHash,
    payer: params.payer,
    signature,
  };
}

/**
 * Verify a payment proof signature. Returns the recovered signer address.
 * Server compares this against the declared payer and the escrow's on-chain payer.
 */
export function verifyPaymentProof(proof: X402PaymentProof): string {
  const messageHash = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32"],
    [proof.taskId, proof.txHash]
  );
  return ethers.verifyMessage(ethers.getBytes(messageHash), proof.signature);
}

/**
 * Parse the X-402-Payment-Required header from a 402 response.
 * Validates required fields are present.
 */
export function parsePaymentRequest(header: string): X402PaymentRequest {
  const parsed = JSON.parse(header);
  if (!parsed.taskId || !parsed.payee || !parsed.amount || !parsed.escrowAddress) {
    throw new Error("Invalid X402 payment request: missing required fields");
  }
  return parsed;
}

/**
 * Parse the X-402-Payment-Proof header from a client request.
 * Validates required fields including signature.
 */
export function parsePaymentProof(header: string): X402PaymentProof {
  const parsed = JSON.parse(header);
  if (!parsed.taskId || !parsed.txHash || !parsed.payer || !parsed.signature) {
    throw new Error("Invalid X402 payment proof: missing required fields");
  }
  return parsed;
}
