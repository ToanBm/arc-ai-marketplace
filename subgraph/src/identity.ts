import { AgentRegistered, AgentUpdated, AgentDeactivated } from "../../generated/IdentityRegistry/IdentityRegistry";
import { Agent } from "../../generated/schema";

export function handleAgentRegistered(event: AgentRegistered): void {
  let agent = new Agent(event.params.wallet);
  agent.name = event.params.name;
  agent.did = event.params.did;
  agent.endpoint = "";
  agent.capabilities = [];
  agent.active = true;
  agent.registeredAt = event.block.timestamp;
  agent.save();
}

export function handleAgentUpdated(event: AgentUpdated): void {
  let agent = Agent.load(event.params.wallet);
  if (agent) {
    agent.endpoint = event.params.endpoint;
    agent.save();
  }
}

export function handleAgentDeactivated(event: AgentDeactivated): void {
  let agent = Agent.load(event.params.wallet);
  if (agent) {
    agent.active = false;
    agent.save();
  }
}
