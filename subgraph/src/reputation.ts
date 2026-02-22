import { BigInt } from "@graphprotocol/graph-ts";
import { FeedbackAdded } from "../../generated/ReputationRegistry/ReputationRegistry";
import { Reputation, Feedback } from "../../generated/schema";

export function handleFeedbackAdded(event: FeedbackAdded): void {
  // Create feedback entry
  let feedbackId = event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let feedback = new Feedback(feedbackId);
  feedback.fromAgent = event.params.from;
  feedback.toAgent = event.params.to;
  feedback.taskId = event.params.taskId;
  feedback.score = event.params.score;
  feedback.timestamp = event.block.timestamp;
  feedback.transactionHash = event.transaction.hash;
  feedback.save();

  // Update reputation aggregate
  let rep = Reputation.load(event.params.to);
  if (!rep) {
    rep = new Reputation(event.params.to);
    rep.totalScore = BigInt.fromI32(0);
    rep.taskCount = BigInt.fromI32(0);
    rep.successCount = BigInt.fromI32(0);
    rep.agent = event.params.to;
  }

  rep.totalScore = rep.totalScore.plus(BigInt.fromI32(event.params.score));
  rep.taskCount = rep.taskCount.plus(BigInt.fromI32(1));
  if (event.params.score >= 3) {
    rep.successCount = rep.successCount.plus(BigInt.fromI32(1));
  }
  rep.lastUpdated = event.block.timestamp;
  rep.save();
}
