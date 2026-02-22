import { TaskCreated, TaskSubmitted, TaskVerified, TaskDisputed } from "../../generated/ValidationRegistry/ValidationRegistry";
import { Task } from "../../generated/schema";

export function handleTaskCreated(event: TaskCreated): void {
  let task = new Task(event.params.taskId);
  task.requester = event.params.requester;
  task.provider = event.params.requester; // Will be updated when provider submits
  task.description = event.params.description;
  task.status = "Pending";
  task.createdAt = event.block.timestamp;
  task.save();
}

export function handleTaskSubmitted(event: TaskSubmitted): void {
  let task = Task.load(event.params.taskId);
  if (task) {
    task.provider = event.params.provider;
    task.resultHash = event.params.resultHash;
    task.status = "Submitted";
    task.completedAt = event.block.timestamp;
    task.save();
  }
}

export function handleTaskVerified(event: TaskVerified): void {
  let task = Task.load(event.params.taskId);
  if (task) {
    task.status = "Verified";
    task.save();
  }
}

export function handleTaskDisputed(event: TaskDisputed): void {
  let task = Task.load(event.params.taskId);
  if (task) {
    task.status = "Disputed";
    task.save();
  }
}
