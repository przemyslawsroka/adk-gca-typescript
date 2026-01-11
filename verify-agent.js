const agentModule = require('./dist/agent.js');
console.log('Type of module:', typeof agentModule);
console.log('Keys:', Object.keys(agentModule));
console.log('Is default present?', 'default' in agentModule);
const agent = agentModule.default;
console.log('Agent name:', agent ? agent.name : 'undefined');
console.log('Is agent LlmAgent?', agent && agent.constructor.name);
