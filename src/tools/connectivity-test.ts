
import { ReachabilityServiceClient } from '@google-cloud/network-management';
import { FunctionTool } from '@google/adk';
import { Type } from '@google/genai';

const client = new ReachabilityServiceClient();

interface ConnectivityTestParams {
  projectId: string;
  sourceIp?: string;
  sourceInstance?: string;
  destIp?: string;
  destInstance?: string;
  destinationPort?: number;
  protocol?: string;
}

async function runConnectivityTest(params: any): Promise<any> {
  const { projectId, sourceIp, sourceInstance, destIp, destInstance, destinationPort, protocol } = params;

  // Generate a unique test ID
  const testId = `adk-test-${Date.now()}`;
  const parent = `projects/${projectId}/locations/global`;
  const name = `${parent}/connectivityTests/${testId}`;

  const request = {
    parent,
    testId,
    resource: {
      name,
      description: 'Created by ADK Network Support Agent',
      source: {
        ipAddress: sourceIp,
        instance: sourceInstance,
      },
      destination: {
        ipAddress: destIp,
        instance: destInstance,
        port: destinationPort,
      },
      protocol: protocol || 'TCP',
    },
  };

  console.log(`Creating Connectivity Test: ${name}...`);

  try {
    const [operation] = await client.createConnectivityTest(request);
    console.log('Waiting for Connectivity Test to complete...');
    const [response] = await operation.promise();

    // Extract Reachability Details
    const result = response.reachabilityDetails?.result;
    const verifyTime = response.reachabilityDetails?.verifyTime;
    const error = response.reachabilityDetails?.error;
    const traces = response.reachabilityDetails?.traces || [];

    // Analyze Trace for Agent Scope Expansion
    const discoveredProjects = new Set<string>();

    // Add the project of source and destination elements if known
    // (though they are usually implicit in the inputs)

    // Traverse traces
    for (const trace of traces) {
      if (trace.steps) {
        for (const step of trace.steps) {
          // Look for project ID in step details
          // Steps often include: instance, network, vpnTunnel, etc. which are full resource names
          // containing project ID.
          const jsonStep = JSON.stringify(step);
          const matches = jsonStep.matchAll(/projects\/([^\/"]+)\//g);
          for (const match of matches) {
            const p = match[1];
            if (p && p !== projectId && p !== 'google-cloud-clients') {
              discoveredProjects.add(p);
            }
          }
        }
      }
    }

    // Clean up test resource to avoid clutter (optional, but good practice for ad-hoc tests)
    // However, user might want to see it in console. 
    // Let's create it, get result, and LEAVE IT for debugging unless user asks to delete.
    // For an automated agent, leaving it might fill up quotas if run in loop. 
    // Let's delete it after 10 seconds or just return the result.
    // The user didn't ask to delete. I'll keep it for now but note it.

    // Actually, deleting it is safer for "test run" feel. 
    // But for "Support", evidence is good.
    // I will delete it to correspond to "ephemeral" check behavior often expected from bots, 
    // or maybe I should update an existing one? 
    // Generically generating new IDs is safest.
    // I'LL DELETE IT to be clean.

    console.log(`Deleting Connectivity Test: ${name}...`);
    await client.deleteConnectivityTest({ name });

    return {
      testId,
      result, // REACHABLE, UNREACHABLE, etc.
      verifyTime,
      errorInfo: error,
      fullTrace: traces, // Return full trace as requested by user
      discoveredScope: Array.from(discoveredProjects),
      message: `Test completed. Result: ${result}. Discovered related projects: ${Array.from(discoveredProjects).join(', ')}`
    };

  } catch (err: any) {
    console.error('Error running connectivity test:', err);
    return {
      error: err.message,
      suggestion: "Ensure API 'networkmanagement.googleapis.com' is enabled and the agent has permissions."
    };
  }
}

export const connectivityTestTool = new FunctionTool({
  name: 'connectivity_test_tool',
  description: 'Creates and runs a Google Cloud Connectivity Test to verify if a packet can travel from a source to a destination. Useful for validating firewall rules, routes, and connectivity. It also analyzes the trace to find new GCP projects involved in the path.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      projectId: {
        type: Type.STRING,
        description: 'The ID of the project where the test will be created (usually the source project).'
      },
      sourceIp: {
        type: Type.STRING,
        description: 'The source IP address.'
      },
      sourceInstance: {
        type: Type.STRING,
        description: 'The source VM Instance URI (e.g., projects/p/zones/z/instances/i).'
      },
      destIp: {
        type: Type.STRING,
        description: 'The destination IP address.'
      },
      destInstance: {
        type: Type.STRING,
        description: 'The destination VM Instance URI.'
      },
      destinationPort: {
        type: Type.INTEGER,
        description: 'The destination port number (for TCP/UDP).'
      },
      protocol: {
        type: Type.STRING,
        description: 'The protocol (TCP, UDP, ICMP). Defaults to TCP.'
      }
    },
    required: ['projectId'],
  },
  execute: runConnectivityTest,
});
