import { RfqCreated, BidSubmitted, BidAwarded } from "../../generated/NegotiationManager/NegotiationManager";
import { Rfq, Bid } from "../../generated/schema";
import { BigInt } from "@graphprotocol/graph-ts";

export function handleRfqCreated(event: RfqCreated): void {
  let rfq = new Rfq(event.params.rfqId);
  rfq.requester = event.params.requester;
  rfq.capability = event.params.capability;
  rfq.description = "";
  rfq.maxBudget = event.params.maxBudget;
  rfq.deadline = BigInt.fromI32(0);
  rfq.status = "Open";
  rfq.createdAt = event.block.timestamp;
  rfq.save();
}

export function handleBidSubmitted(event: BidSubmitted): void {
  let bid = new Bid(event.params.bidId);
  bid.rfq = event.params.rfqId;
  bid.provider = event.params.provider;
  bid.price = event.params.price;
  bid.estimatedTime = BigInt.fromI32(0);
  bid.terms = "";
  bid.status = "Active";
  bid.submittedAt = event.block.timestamp;
  bid.save();
}

export function handleBidAwarded(event: BidAwarded): void {
  let bid = Bid.load(event.params.bidId);
  if (bid) {
    bid.status = "Won";
    bid.save();
  }

  let rfq = Rfq.load(event.params.rfqId);
  if (rfq) {
    rfq.status = "Awarded";
    rfq.winningBid = event.params.bidId;
    rfq.save();
  }
}
