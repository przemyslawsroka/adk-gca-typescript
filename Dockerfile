FROM node:20-slim

WORKDIR /app

COPY package.json ./
COPY tsconfig.json ./
# Skip package-lock.json to avoid internal registry URLs
RUN npm install --registry=https://registry.npmjs.org/

COPY src ./src
COPY public ./public

# Build
RUN npm run build

# Start
# Start ADK DevTools Web UI (as requested for production)
CMD ["npx", "@google/adk-devtools", "web", "./dist/agent.js", "--host", "0.0.0.0", "--port", "8080"]
