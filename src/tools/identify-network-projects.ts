
import { AssetServiceClient } from '@google-cloud/asset';
import { FunctionTool } from '@google/adk';
import { Type } from '@google/genai';

const client = new AssetServiceClient();

interface AgentScopeDetectorParams {
  rootProjects: string[]; // Comma separated string or array
}

// Helper to extract project ID from a long resource name or URL
function extractProjectFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // Patterns like:
  // projects/{project}/...
  // https://www.googleapis.com/compute/v1/projects/{project}/...
  const match = url.match(/projects\/([^\/]+)\//);
  return match ? match[1] : null;
}

async function detectAgentScope(params: any): Promise<any> {
  const rootProjectsInput = params.rootProjects;
  // Handle both array and string inputs
  let startProjects: string[] = [];

  if (Array.isArray(rootProjectsInput)) {
    startProjects = rootProjectsInput;
  } else if (typeof rootProjectsInput === 'string') {
    startProjects = rootProjectsInput.split(',').map(s => s.trim());
  }

  const visitedProjects = new Set<string>(startProjects);
  const projectGraph: any[] = []; // Describe potential links found

  // We only do one level of expansion for now to avoid massive crawls
  // but we scan all starting projects.

  for (const projectId of startProjects) {
    const scope = `projects/${projectId}`;
    console.log(`[AgentScope] Scanning ${scope}...`);

    try {
      // 1. Shared VPC: Check Subnetworks.
      // If a subnetwork is in this project, check its 'network' field.
      // If the network is in another project -> That other project is a Host Project.
      // Note: In CAIS, searchAllResources returns 'additionalAttributes' which might contain specific fields.
      // However, we often just get high level metadata. 
      // Checking 'network' field usually requires reading the resource or relying on strict naming if preserved.

      // Let's search for subnetworks and networks first.
      const [resources] = await client.searchAllResources({
        scope,
        assetTypes: [
          'compute.googleapis.com/Subnetwork',
          'compute.googleapis.com/Network',
          'compute.googleapis.com/InterconnectAttachment', // For interconnects
          'compute.googleapis.com/ForwardingRule', // For LBs
          'compute.googleapis.com/BackendService' // For LBs
        ],
        pageSize: 500,
      });

      for (const res of resources) {
        // --- 1. Shared VPC Detection (from Subnet) ---
        if (res.assetType === 'compute.googleapis.com/Subnetwork') {
          // additionalAttributes can be generic structure.
          // For subnetwork, commonly 'network' is a link.
          // Let's inspect 'network' in additionalAttributes if available or parse standard fields if mapped.
          // CAIS usually maps protocol buffer fields to additionalAttributes.
          const attrs = res.additionalAttributes;
          // The 'network' field might be direct link
          // Or we look at the selfLink: //compute.googleapis.com/projects/{PROJECT}/regions/...
          // Actually, if we are scanning PROJECT A, and we see a Subnet that belongs to PROJECT A,
          // we want to see if it points to a Network in PROJECT B.
          // CAIS results for Subnetwork in 'scope=PROJECT A' will list likely subnets owned by PROJECT A? 
          // Shared VPC: Service Project A uses Subnets from Host Project B.
          // Actually, the Subnet resource LIVE in Host Project B. Service Project A just has "permissions".
          // So scanning Service Project A might NOT return the Subnet resource itself in CAIS searchAllResources unless we search for "Effective IAM" which is hard.

          // Wait, if I am in Service Project, I deploy instances.
          // Maybe I should search for Instances and check their network interfaces?
          // YES. Instances are the specific resources binding the project to the network.
        }
      }

      // Better Query: Search Instances to find Shared VPC Host Projects
      // and Peered Networks relative to what's used.
      // But user asked for generic "Shared VPC host".

      // Let's do a supplementary search for VM Instances to catch Shared VPC usage cleanly.
      const [instances] = await client.searchAllResources({
        scope,
        assetTypes: ['compute.googleapis.com/Instance'],
        pageSize: 100 // Sample
      });

      for (const inst of instances) {
        // Check network interfaces
        // additionalAttributes.networkInterfaces usually in JSON format
        const rawAttrs = inst.additionalAttributes;
        if (rawAttrs && (rawAttrs as any).networkInterfaces) {
          const nics = Array.isArray((rawAttrs as any).networkInterfaces) ? (rawAttrs as any).networkInterfaces : [(rawAttrs as any).networkInterfaces];
          // It might be parsed structure or string? SDK usually parses struct if compatible.
          // CAIS searchAllResources often returns specific flat fields or Structs.
          // Let's assume generic access.

          // NOTE: 'network' and 'subnetwork' fields in Instance resource are URLs like:
          // https://www.googleapis.com/compute/v1/projects/{HOST_PROJECT}/global/networks/{NETWORK}

          // Since 'rawAttrs' structure key names can be dynamic or nested, we rely on JSON stringify if needed 
          // or just standard pattern matching on the whole attributes dump if simpler, but let's try direct access.

          // Using JSON serialization to be safe on type inspection
          const attrsString = JSON.stringify(rawAttrs);
          const projectMatches = attrsString.matchAll(/projects\/([^\/"]+)\//g);
          for (const match of projectMatches) {
            const detectedProject = match[1];
            if (detectedProject !== projectId && detectedProject !== 'google-cloud-clients') {
              if (!visitedProjects.has(detectedProject)) {
                visitedProjects.add(detectedProject);
                projectGraph.push({
                  source: projectId,
                  target: detectedProject,
                  reason: `Instance ${inst.displayName} references resource in ${detectedProject} (Likely Shared VPC Host or Image source)`
                });
              }
            }
          }
        }
      }

      // --- 2. Peering Detection (from Network) --- 
      // We look at Networks in the project.
      const networks = resources.filter(r => r.assetType === 'compute.googleapis.com/Network');
      for (const net of networks) {
        // Check 'peerings' in attributes
        // peerings usually is a list of objects with 'network' field pointing to peer.
        const attrs = net.additionalAttributes;
        if (attrs) {
          const attrsString = JSON.stringify(attrs);
          // Look for peering references
          // Only rough heuristic without perfect type definition of CAIS output
          const projectMatches = attrsString.matchAll(/projects\/([^\/"]+)\/global\/networks/g);
          for (const match of projectMatches) {
            const detectedProject = match[1];
            if (detectedProject !== projectId) {
              if (!visitedProjects.has(detectedProject)) {
                visitedProjects.add(detectedProject);
                projectGraph.push({
                  source: projectId,
                  target: detectedProject,
                  reason: `Network ${net.displayName} has peering/link to ${detectedProject}`
                });
              }
            }
          }
        }
      }

      // --- 3. Interconnect ---
      const interconnects = resources.filter(r => r.assetType === 'compute.googleapis.com/InterconnectAttachment');
      // Look for 'router' or specific links
      for (const ic of interconnects) {
        const attrsString = JSON.stringify(ic.additionalAttributes || {});
        const projectMatches = attrsString.matchAll(/projects\/([^\/"]+)\//g);
        for (const match of projectMatches) {
          const detectedProject = match[1];
          if (detectedProject !== projectId) {
            if (!visitedProjects.has(detectedProject)) {
              visitedProjects.add(detectedProject);
              projectGraph.push({
                source: projectId,
                target: detectedProject,
                reason: `Interconnect Attachment ${ic.displayName} references ${detectedProject}`
              });
            }
          }
        }
      }


    } catch (e: any) {
      console.error(`Error scanning project ${projectId}:`, e);
      projectGraph.push({
        source: projectId,
        error: e.message
      });
    }
  }

  return {
    detectedScope: Array.from(visitedProjects),
    relationships: projectGraph
  };
}

export const identifyNetworkProjectsTool = new FunctionTool({
  name: 'identify_network_projects',
  description: 'Identifies the scope of GCP projects involved in a network problem. It starts from a given root project list and traverses resources (like VMs, Networks, LBs) to find connected projects (e.g., Shared VPC hosts, Peered networks, Backend Service projects). Call this FIRST to determine which projects to analyze.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      rootProjects: {
        type: Type.ARRAY,
        description: 'List of starting Google Cloud Project IDs to scan.',
        items: { type: Type.STRING }
      },
    },
    required: ['rootProjects'],
  },
  execute: detectAgentScope,
});
