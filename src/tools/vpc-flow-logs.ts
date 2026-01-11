
import { BigQuery } from '@google-cloud/bigquery';
import { FunctionTool } from '@google/adk';
import { Type } from '@google/genai';

const bigquery = new BigQuery();

interface FlowLogsParams {
  projects: string[]; // List of projects to query (e.g., Service Project, Host Project)
  sourceIp: string;
  destIp: string;
  limit?: number;
  hoursAgo?: number;
}

async function queryVpcFlowLogs(params: any): Promise<any> {
  const { projects, sourceIp, destIp, limit = 20, hoursAgo = 1 } = params;

  // Clean inputs
  const projectList = Array.isArray(projects) ? projects : [projects];
  const uniqueProjects = Array.from(new Set(projectList)); // Dedup

  const results: any[] = [];
  const errors: any[] = [];

  console.log(`Querying VPC Flow Logs for ${sourceIp} <-> ${destIp} in projects: ${uniqueProjects.join(', ')}...`);

  for (const projectId of uniqueProjects) {
    // Construct query for this project
    // View: `{projectId}.flow_logs._Default`
    // We select relevant fields to keep context small
    const query = `
      SELECT
        timestamp,
        jsonPayload.connection.src_ip as src_ip,
        jsonPayload.connection.src_port as src_port,
        jsonPayload.connection.dest_ip as dest_ip,
        jsonPayload.connection.dest_port as dest_port,
        jsonPayload.connection.protocol as protocol,
        jsonPayload.bytes_sent as bytes_sent,
        jsonPayload.rtt_msec as rtt_msec,
        resource.labels.subnetwork_name as subnetwork_name,
        resource.labels.project_id as resource_project_id
      FROM \`${projectId}.flow_logs._Default\`
      WHERE
        timestamp > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @hoursAgo HOUR)
        AND (
          (jsonPayload.connection.src_ip = @sourceIp AND jsonPayload.connection.dest_ip = @destIp)
          OR
          (jsonPayload.connection.src_ip = @destIp AND jsonPayload.connection.dest_ip = @sourceIp)
        )
      ORDER BY timestamp DESC
      LIMIT @limit
    `;

    const options = {
      query,
      location: 'US', // Default to US, but might need to be dynamic or catch error if dataset is elsewhere
      params: { sourceIp, destIp, limit, hoursAgo },
    };

    try {
      console.log(`Executing BQ query in ${projectId}...`);
      // Use the client initialized with ADC. 
      // Note: Querying a table in another project requires permissions and standard SQL syntax with project ID.
      // The `bigquery.query()` method can run a job in the billing project (default) 
      // but read from the target project table.

      const [rows] = await bigquery.query(options);

      if (rows.length > 0) {
        results.push(...rows.map(row => ({
          ...row,
          source_dataset_project: projectId // Track where this row came from
        })));
      } else {
        console.log(`No matching flow logs found in ${projectId}.`);
      }
    } catch (err: any) {
      console.warn(`Failed to query flow logs in ${projectId}: ${err.message}`);
      // Common error: Table not found or Dataset in different location
      errors.push({ projectId, error: err.message });

      // If location error, we could retry? simple fallback not implemented for now.
    }
  }

  // Sort combined results by timestamp desc
  results.sort((a, b) => {
    const tA = new Date(a.timestamp?.value || a.timestamp).getTime();
    const tB = new Date(b.timestamp?.value || b.timestamp).getTime();
    return tB - tA;
  });

  const finalResults = results.slice(0, limit);

  return {
    recordCount: finalResults.length,
    records: finalResults,
    errors: errors.length > 0 ? errors : undefined,
    message: finalResults.length > 0
      ? `Found ${finalResults.length} flow log entries.`
      : `No flow logs found. Verified in projects: ${uniqueProjects.join(', ')}. Ensure VPC Flow Logs are ENABLED and exported to BigQuery dataset 'flow_logs' in these projects.`
  };
}

export const vpcFlowLogsTool = new FunctionTool({
  name: 'query_vpc_flow_logs',
  description: 'Queries VPC Flow Logs from BigQuery to see REAL traffic between two IPs. Useful for verifying if traffic is actually passing or being blocked. Requires VPC Flow Logs to be exported to BigQuery.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      projects: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of projects to query (e.g. source project, shared VPC host project).'
      },
      sourceIp: { type: Type.STRING, description: 'Source IP address' },
      destIp: { type: Type.STRING, description: 'Destination IP address' },
      limit: { type: Type.INTEGER, description: 'Max number of rows to return (default 20)' },
      hoursAgo: { type: Type.INTEGER, description: 'Lookback window in hours (default 1)' }
    },
    required: ['projects', 'sourceIp', 'destIp']
  },
  execute: queryVpcFlowLogs
});
