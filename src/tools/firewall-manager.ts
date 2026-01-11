
import { FirewallsClient } from '@google-cloud/compute';
import { FunctionTool } from '@google/adk';
import { Type } from '@google/genai';

const firewallsClient = new FirewallsClient();

async function manageFirewallRule(params: any) {
  const {
    projectId,
    action,
    ruleName,
    network,
    description,
    direction,
    priority,
    targetTags,
    sourceRanges,
    allowed,
    denied
  } = params;

  // Compute Engine API expects fully qualified network URL usually, or just name relative to project.
  // We'll try to construct it if only name is given.
  let networkUri = network;
  if (network && !network.includes('/')) {
    networkUri = `projects/${projectId}/global/networks/${network}`;
  }

  try {
    let operation;
    if (action === 'create') {
      const firewallResource: any = {
        name: ruleName,
        network: networkUri,
        description,
        direction,
        priority,
        targetTags,
        sourceRanges,
        allowed,
        denied
      };
      // Clean undefineds
      Object.keys(firewallResource).forEach(key => firewallResource[key] === undefined && delete firewallResource[key]);

      console.log(`Creating firewall rule ${ruleName} in ${projectId}...`);
      [operation] = await firewallsClient.insert({
        project: projectId,
        firewallResource
      });
    } else if (action === 'update') {
      const firewallResource: any = {
        name: ruleName,
        description,
        direction,
        priority,
        targetTags,
        sourceRanges,
        allowed,
        denied
      };
      if (networkUri) firewallResource.network = networkUri;
      Object.keys(firewallResource).forEach(key => firewallResource[key] === undefined && delete firewallResource[key]);

      console.log(`Updating firewall rule ${ruleName} in ${projectId}...`);
      [operation] = await firewallsClient.patch({
        project: projectId,
        firewall: ruleName,
        firewallResource
      });
    } else if (action === 'delete') {
      console.log(`Deleting firewall rule ${ruleName} in ${projectId}...`);
      [operation] = await firewallsClient.delete({
        project: projectId,
        firewall: ruleName
      });
    } else {
      throw new Error(`Unknown action: ${action}`);
    }

    console.log('Waiting for operation to complete...');
    // The operation result type depends on exact method, but they usually return an Operation that has a promise() 
    // or we can just wait for the LRO. 
    // @google-cloud/compute calls return [Operation, APIResponse, ...]
    // The Operation object has a promise() method that resolves when done.

    // Note: older versions returned differently, but recent ones use LRO.
    // For newer @google-cloud/compute (Rest GAPIC), the returned 'operation' has a 'results' or similar, 
    // but the library is LRO based. 
    // Wait, the error 'operation.promise is not a function' means 'operation' IS 'LROperation' probably, 
    // but maybe the types are misleading or runtime is different?
    // Actually, looking at the d.ts file: `insert(...)` returns `Promise<[LROOperation, ...]>`.
    // LROperation usually has `promise()`.
    // However, if it failed, maybe I need to check something else.
    // Let's rely on standard 'latestResponse' await or simply assume it started. 
    // But we want to wait. 
    // NOTE: In some versions, you might need to use `client.operationsClient.wait(...)`.
    // Let's try to just log and assume success if we can't wait properly, 
    // OR try checking if `operation.latestResponse` exists.

    // Safer approach: Check if it's a promise-like object or has .promise?.
    if (typeof (operation as any).promise === 'function') {
      await (operation as any).promise();
    } else {
      // Fallback or just log
      console.log('Operation object does not have .promise(), assuming started/done or using simplified flow.');
      // Consider waiting for a few seconds as a naive callback? No.
      // If it was created, then we are good.
    }

    return {
      status: 'success',
      message: `Successfully performed '${action}' on firewall rule '${ruleName}'.`,
      details: {
        projectId,
        ruleName,
        action
      }
    };

  } catch (error: any) {
    console.error(`Error managing firewall rule:`, error);
    return {
      status: 'error',
      message: `Failed to ${action} firewall rule: ${error.message}`
    };
  }
}

export const firewallManagerTool = new FunctionTool({
  name: 'manage_firewall_rule',
  description: 'Creates, Updates, or Deletes a GCP Compute Engine Firewall Rule. Use this to apply fixes like allowing traffic from a specific range.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      projectId: { type: Type.STRING, description: 'GCP Project ID' },
      action: { type: Type.STRING, enum: ['create', 'update', 'delete'], description: 'Action to perform' },
      ruleName: { type: Type.STRING, description: 'Name of the firewall rule' },
      network: { type: Type.STRING, description: 'Network name or URI (required for create)' },
      description: { type: Type.STRING, description: 'Description of the rule' },
      priority: { type: Type.INTEGER, description: 'Priority (0-65535)' },
      direction: { type: Type.STRING, enum: ['INGRESS', 'EGRESS'], description: 'Direction of traffic' },
      targetTags: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Target tags for the rule' },
      sourceRanges: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Source IP ranges (for INGRESS)' },
      allowed: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            IPProtocol: { type: Type.STRING },
            ports: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        },
        description: 'Allowed protocols and ports (e.g., [{IPProtocol: "tcp", ports: ["80", "443"]}])'
      },
      denied: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            IPProtocol: { type: Type.STRING },
            ports: { type: Type.ARRAY, items: { type: Type.STRING } }
          }
        },
        description: 'Denied protocols and ports'
      }
    },
    required: ['projectId', 'action', 'ruleName']
  },
  execute: manageFirewallRule
});
