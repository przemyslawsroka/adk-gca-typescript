
import express from 'express';
import bodyParser from 'body-parser';
import { runAgent } from './agent';

import path from 'path';

const app = express();
app.use(express.static(path.join(__dirname, '../public')));
app.use(bodyParser.json());

const port = process.env.PORT || 8080;

app.post('/', async (req: express.Request, res: express.Response) => {
  // Basic health check or info
  res.send({ status: 'ok', service: 'adk-network-agent' });
});

app.post('/query', async (req: express.Request, res: express.Response) => {
  try {
    const { prompt, projectId } = req.body;

    if (!prompt) {
      res.status(400).send({ error: 'Prompt is required' });
      return;
    }
    // define projectId: default to env if not provided, or require it
    const targetProjectId = projectId || process.env.GOOGLE_CLOUD_PROJECT;
    if (!targetProjectId) {
      res.status(400).send({ error: 'ProjectId is required in body or GOOGLE_CLOUD_PROJECT env var' });
      return;
    }

    console.log(`Received query: ${prompt} for project: ${targetProjectId}`);
    const result = await runAgent(prompt, targetProjectId);
    res.send(result);
  } catch (error: any) {
    console.error('Error processing query:', error);
    res.status(500).send({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`ADK Agent listening on port ${port}`);
});
