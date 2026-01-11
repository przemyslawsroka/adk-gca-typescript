import { LlmAgent, Gemini, Runner, InMemorySessionService, InMemoryMemoryService, stringifyContent } from '@google/adk';
import { fetchNetworkArchitectureTool } from './tools/fetch-network-architecture';
import { identifyNetworkProjectsTool } from './tools/identify-network-projects';
import { connectivityTestTool } from './tools/connectivity-test';
import { firewallManagerTool } from './tools/firewall-manager';
import { vpcFlowLogsTool } from './tools/vpc-flow-logs';
import { Content } from '@google/genai';

const model = new Gemini({
  model: 'gemini-2.0-flash-exp',
  vertexai: true,
  location: 'us-central1',
  project: process.env.GOOGLE_CLOUD_PROJECT || 'przemeksroka-joonix-service',
});

const problems = `
`;

const firewallAdminAgent = new LlmAgent({
  name: 'firewall_admin',
  description: 'Deploys and manages firewall rules. Use only when a specific fix is requested.',
  model,
  tools: [firewallManagerTool],
  instruction: `You are the Firewall Admin.
  Your Goal: Apply firewall mutations (Create/Update/Delete) as requested.
  - You possess the 'manage_firewall_rule' tool.
  - ALWAYS confirm with the user before executing a mutation if not explicitly confirmed in the immediate prompt.
  - After applying a fix, report the status and Transfer back to 'troubleshooter'.`,
});

const troubleshooterAgent = new LlmAgent({
  name: 'troubleshooter',
  description: 'Diagnoses network connectivity issues, finds root causes, and proposes fixes.',
  model,
  tools: [fetchNetworkArchitectureTool, identifyNetworkProjectsTool, connectivityTestTool, vpcFlowLogsTool],
  subAgents: [firewallAdminAgent],
  instruction: `You are the Network Troubleshooter.
  Your Goal: Identify the root cause of network issues.
  
  **Procedure**:
  1. **Scope & Test**: Use 'identify_network_projects' and 'connectivity_test_tool'.
  2. **Analyze**: Use 'fetch_network_architecture' and 'query_vpc_flow_logs' (for verification).
  3. **Conclude**: State the root cause clearly.
  4. **Propose Fix**: If a firewall rule is missing, describe the rule that needs to be added (Project, Network, Ports, Source/Dest).
  5. **Handover**: ASK the user: "Would you like to apply this fix?"
     - **IF USER AGREES**: Transfer to 'firewall_admin'.
  
  **IMPORTANT**: You DO NOT have permission to change settings. You only diagnose.`,
});

const agent = new LlmAgent({
  name: 'network_support',
  model,
  tools: [], // Root agent doesn't need low-level tools, it delegates.
  subAgents: [troubleshooterAgent],
  instruction: `You are the Network Support Coordinator.
  Your job is to manage the user's request by delegating to specialized agents:
  
  - For ANY network issue, connectivity problem, or request to fix something -> Delegate to 'troubleshooter'.
  - Even if the user asks to "Create a firewall rule", delegate to 'troubleshooter' first (who will validate and hand off to 'firewall_admin').
  
  Always trust your sub-agents to do the work.`,
});

// Remove CodeExecutionRequestProcessor to avoid "Multiple tools" error with Gemini 2.0 Flash Exp
// We identify it by checking if runAsync uses 'codeExecutor' or 'executeCode'
agent.requestProcessors = agent.requestProcessors.filter(p => !p.runAsync.toString().includes('codeExecutor'));

const sessionService = new InMemorySessionService();
const memoryService = new InMemoryMemoryService();

const runner = new Runner({
  appName: 'adk-network-agent',
  agent,
  sessionService,
  memoryService
});

export async function runAgent(prompt: string, projectId: string) {
  const userId = 'user';
  const sessionId = 'session-' + Date.now();

  const newMessage: any = {
    role: 'user',
    parts: [{ text: `Project ID: ${projectId}. ${prompt}` }]
  };

  // Ensure session exists
  try {
    const session = await sessionService.getSession({
      appName: 'adk-network-agent',
      userId,
      sessionId
    });

    if (!session) {
      await sessionService.createSession({
        appName: 'adk-network-agent',
        userId,
        sessionId
      });
    }
  } catch (e) {
    console.log('Error checking/creating session', e)
    await sessionService.createSession({
      appName: 'adk-network-agent',
      userId,
      sessionId
    });
  }


  const iterator = runner.runAsync({
    userId,
    sessionId,
    newMessage
  });

  const events = [];
  for await (const event of iterator) {
    events.push(event);
  }

  const textResponses = events
    .filter(e => e.author === agent.name) // Messages from agent
    .map(e => stringifyContent(e))                // Extract text
    .filter(text => text.trim().length > 0);      // Only non-empty

  return {
    response: textResponses.join('\n'), // Join generic text responses
    details: events
  };
}

export default agent;
