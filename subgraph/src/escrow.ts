import { EscrowCreated, EscrowReleased, EscrowRefunded, EscrowExpired } from "../../generated/PaymentEscrow/PaymentEscrow";
import { Escrow } from "../../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

export function handleEscrowCreated(event: EscrowCreated): void {
  let escrow = new Escrow(event.params.taskId);
  escrow.task = event.params.taskId;
  escrow.payer = event.params.payer;
  escrow.payee = event.params.payee;
  escrow.amount = event.params.amount;
  escrow.status = "Funded";
  escrow.createdAt = event.block.timestamp;
  escrow.deadline = BigInt.fromI32(0); // Updated from contract read if needed
  escrow.save();
}

export function handleEscrowReleased(event: EscrowReleased): void {
  let escrow = Escrow.load(event.params.taskId);
  if (escrow) {
    escrow.status = "Released";
    escrow.save();
  }
}

export function handleEscrowRefunded(event: EscrowRefunded): void {
  let escrow = Escrow.load(event.params.taskId);
  if (escrow) {
    escrow.status = "Refunded";
    escrow.save();
  }
}

export function handleEscrowExpired(event: EscrowExpired): void {
  let escrow = Escrow.load(event.params.taskId);
  if (escrow) {
    escrow.status = "Expired";
    escrow.save();
  }
}
