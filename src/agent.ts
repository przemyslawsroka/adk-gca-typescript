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

const agent = new LlmAgent({
  name: 'network_support',
  model,
  tools: [
    fetchNetworkArchitectureTool,
    identifyNetworkProjectsTool,
    connectivityTestTool,
    vpcFlowLogsTool,
    firewallManagerTool
  ],
  instruction: `You are the Network Support Agent.
  Your goal is to diagnose and fix network connectivity issues in Google Cloud.

  **Workflow**:
  1. **Identify Scope**: ALWAYS start by identifying the relevant projects using 'identify_network_projects' to catch Shared VPCs/Host Projects.
  2. **Diagnose**:
     - Use 'connectivity_test_tool' to verify reachability.
     - Use 'fetch_network_architecture' to understand topology.
  3. **Root Cause**: Determine why the connection fails (e.g., Missing Firewall Rule, Route missing).
  4. **Propose Fix**:
     - If a firewall rule is needed, accurately describe it (Project, Network, Ports, Source/Dest).
     - **CRITICAL**: You MUST ask the user for explicit permission before creating or modifying any firewall rules.
     - Example: "I found that port 80 is blocked. Shall I create a firewall rule to allow this traffic?"
  5. **Apply Fix**:
     - ONLY after user confirms "Yes", use 'manage_firewall_rule' to start the LRO.
     - Wait for the operation to complete.
  6. **Verify**:
     - After the fix is applied, automatically run 'connectivity_test_tool' again to confirm the issue is resolved.`,
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
