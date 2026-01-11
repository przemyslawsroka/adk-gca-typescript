
import { AssetServiceClient } from '@google-cloud/asset';
import { FunctionTool } from '@google/adk';
import { Type } from '@google/genai';

const client = new AssetServiceClient();

// Validation schema for internal use (optional, or just trust the input)
// const NetworkSchema = z.object({
//   projectId: z.string().describe('The Google Cloud Project ID to analyze'),
// });

async function describeNetworkArchitecture(params: any) {
  const projectId = params.projectId;
  const scope = `projects/${projectId}`;
  const assetTypes = [
    'compute.googleapis.com/Network',
    'compute.googleapis.com/Subnetwork',
    'compute.googleapis.com/Firewall',
    'compute.googleapis.com/Route',
    'compute.googleapis.com/VpnTunnel',
    'compute.googleapis.com/ForwardingRule',
    'compute.googleapis.com/UrlMap',
    'compute.googleapis.com/TargetHttpProxy',
    'compute.googleapis.com/BackendService'
  ];

  console.log(`Searching assets in ${scope}...`);

  try {
    const [resources] = await client.searchAllResources({
      scope,
      assetTypes,
      pageSize: 500, // Limit to 500 resources for now to fit in context
    });

    // Group by type for better readability
    const summary: Record<string, any[]> = {};
    for (const res of resources) {
      const type = res.assetType || 'unknown';
      if (!summary[type]) summary[type] = [];

      summary[type].push({
        name: res.name,
        displayName: res.displayName,
        location: res.location,
        description: res.description,
        additionalAttributes: res.additionalAttributes,
      });
    }

    // Return a condensed summary string
    return {
      resourceCount: resources.length,
      resources: summary
    };
  } catch (error: any) {
    console.error('Error querying Cloud Asset Inventory:', error);
    throw new Error(`Failed to list assets: ${error.message}`);
  }
}

export const fetchNetworkArchitectureTool = new FunctionTool({
  name: 'fetch_network_architecture',
  description: 'Retrieves and describes the network architecture (networks, subnets, firewalls, routes, load balancers, etc.) of a Google Cloud project using Cloud Asset Inventory. Use this to understand the network topology.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      projectId: {
        type: Type.STRING,
        description: 'The Google Cloud Project ID to analyze',
      },
    },
    required: ['projectId'],
  },
  execute: describeNetworkArchitecture,
});
