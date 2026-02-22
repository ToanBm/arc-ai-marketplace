import { DisputeFiled, EvidenceSubmitted, DisputeResolved } from "../../generated/ArbitrationRegistry/ArbitrationRegistry";
import { Dispute } from "../../generated/schema";

export function handleDisputeFiled(event: DisputeFiled): void {
  let dispute = new Dispute(event.params.taskId);
  dispute.task = event.params.taskId;
  dispute.payer = event.params.payer;
  dispute.payee = event.params.payee;
  dispute.reason = event.params.reason;
  dispute.ruling = "Pending";
  dispute.filedAt = event.block.timestamp;
  dispute.save();
}

export function handleEvidenceSubmitted(event: EvidenceSubmitted): void {
  let dispute = Dispute.load(event.params.taskId);
  if (dispute) {
    dispute.evidence = event.params.evidence;
    dispute.save();
  }
}

export function handleDisputeResolved(event: DisputeResolved): void {
  let dispute = Dispute.load(event.params.taskId);
  if (dispute) {
    let ruling = event.params.ruling;
    if (ruling == 1) {
      dispute.ruling = "FavorPayer";
    } else if (ruling == 2) {
      dispute.ruling = "FavorPayee";
    }
    dispute.arbitrator = event.params.arbitrator;
    dispute.resolvedAt = event.block.timestamp;
    dispute.save();
  }
}
