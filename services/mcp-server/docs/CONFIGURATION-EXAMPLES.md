# DMR-X MCP Server — Configuration Examples

This file contains configuration examples for different deployment scenarios.

## Table of Contents

- [Development Setup](#development-setup)
- [Production Setup](#production-setup)
- [Enterprise Setup with RBAC](#enterprise-setup-with-rbac)
- [Multi-Instance Federation](#multi-instance-federation)
- [A2A Agent Discovery](#a2a-agent-discovery)
- [Docker Deployment](#docker-deployment)
- [Kubernetes Deployment](#kubernetes-deployment)

---

## Development Setup

Minimal configuration for local development.

```json
{
  "transport": "stdio",
  "router": {
    "epsilon": 0.05,
    "defaultQualityTarget": "balanced"
  },
  "toolSearch": {
    "enableBM25": true,
    "enableSemantic": false
  }
}
```

**Environment Variables:**
```bash
# Required for LLM routing
export OPENAI_API_KEY="sk-..."

# Optional: Local Ollama for embeddings
# Ollama runs on localhost:11434 by default
```

---

## Production Setup

Production-ready configuration with all features enabled.

```json
{
  "transport": "sse",
  "port": 3100,
  "host": "0.0.0.0",
  "apiKey": "${DMRX_MCP_API_KEY}",
  "maxBodyBytes": 10485760,
  "corsOrigin": "https://your-domain.com",
  "sessionTimeoutMs": 300000,
  
  "router": {
    "epsilon": 0.05,
    "defaultQualityTarget": "balanced",
    "enableDecomposition": false
  },
  
  "toolSearch": {
    "bm25Weight": 0.4,
    "semanticWeight": 0.6,
    "enableBM25": true,
    "enableSemantic": true,
    "embeddingConfig": {
      "provider": "openai",
      "openaiApiKey": "${OPENAI_API_KEY}",
      "openaiModel": "text-embedding-3-small"
    }
  },
  
  "guardrails": {
    "enabled": true,
    "piiRedaction": true,
    "contentFiltering": true,
    "blockedKeywords": ["password", "secret", "api_key"],
    "logDetections": true
  },
  
  "audit": {
    "enabled": true,
    "retentionDays": 90,
    "includeBodies": false
  },
  
  "rateLimit": {
    "dmrx_chat": "1000/hour",
    "dmrx_generate_image": "100/hour",
    "dmrx_batch": "50/hour"
  },
  
  "telemetry": {
    "enabled": true,
    "metricsPort": 9465,
    "otlpEndpoint": "http://localhost:4318/v1/traces",
    "enableTracing": true,
    "enableMetrics": true
  },
  
  "externalServers": [
    {
      "id": "github",
      "name": "GitHub MCP Server",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  ]
}
```

---

## Enterprise Setup with RBAC

Enterprise configuration with role-based access control.

```json
{
  "transport": "http",
  "port": 3100,
  "host": "0.0.0.0",
  "apiKey": "${DMRX_MCP_API_KEY}",
  
  "rbac": {
    "enabled": true,
    "defaultEffect": "deny",
    "auditLogging": true
  },
  
  "guardrails": {
    "enabled": true,
    "piiRedaction": true,
    "contentFiltering": true,
    "blockedKeywords": ["password", "secret", "api_key", "ssn", "credit_card"]
  },
  
  "audit": {
    "enabled": true,
    "retentionDays": 365,
    "includeBodies": true
  },
  
  "apiKeysConfig": [
    {
      "key": "${ADMIN_API_KEY}",
      "allowedTools": ["*"]
    },
    {
      "key": "${USER_API_KEY}",
      "allowedTools": ["dmrx_chat", "dmrx_models", "dmrx_status"]
    }
  ]
}
```

### RBAC Policy Files

Create policy files in the policies directory:

**policies/admin-full-access.cedar**
```
permit(
  principal == Role::"admin",
  action,
  resource
);
```

**policies/user-read-only.cedar**
```
permit(
  principal == Role::"user",
  action in [Action::"dmrx_chat", Action::"dmrx_models", Action::"dmrx_status"],
  resource
);
```

**policies/deny-bash-non-admin.cedar**
```
deny(
  principal != Role::"admin",
  action == Action::"dmrx_bash",
  resource
);
```

---

## Multi-Instance Federation

Configure multiple DMR-X instances to share tools.

### Instance 1 (Primary)

```json
{
  "transport": "sse",
  "port": 3100,
  
  "federation": {
    "enabled": true,
    "instanceId": "dmrx-primary",
    "instanceName": "DMR-X Primary",
    "discoveryMethod": "static",
    "peers": [
      {
        "id": "dmrx-secondary",
        "name": "DMR-X Secondary",
        "url": "http://192.168.1.101:3100"
      }
    ],
    "syncInterval": 30,
    "heartbeatInterval": 10,
    "enableToolProxy": true,
    "maxRemoteTools": 50
  }
}
```

### Instance 2 (Secondary)

```json
{
  "transport": "sse",
  "port": 3100,
  
  "federation": {
    "enabled": true,
    "instanceId": "dmrx-secondary",
    "instanceName": "DMR-X Secondary",
    "discoveryMethod": "static",
    "peers": [
      {
        "id": "dmrx-primary",
        "name": "DMR-X Primary",
        "url": "http://192.168.1.100:3100"
      }
    ],
    "syncInterval": 30,
    "heartbeatInterval": 10,
    "enableToolProxy": true,
    "maxRemoteTools": 50
  }
}
```

---

## A2A Agent Discovery

Enable A2A protocol for agent-to-agent communication.

```json
{
  "transport": "sse",
  "port": 3100,
  
  "a2a": {
    "enabled": true,
    "agentCard": {
      "name": "DMR-X Image Generator",
      "description": "Specialized agent for image generation tasks",
      "version": "1.0.0",
      "url": "http://localhost:3100"
    }
  },
  
  "allowedTools": ["dmrx_generate_image", "dmrx_generate_image_stream"]
}
```

### Discovering Agents

```bash
# Discover agent capabilities
curl http://localhost:3100/.well-known/agent.json

# Response
{
  "name": "DMR-X Image Generator",
  "description": "Specialized agent for image generation tasks",
  "version": "1.0.0",
  "url": "http://localhost:3100",
  "capabilities": {
    "streaming": true
  },
  "skills": [
    {
      "id": "dmrx_generate_image",
      "name": "dmrx_generate_image",
      "description": "Generate images through DMR-X...",
      "tags": ["diffusion"]
    }
  ]
}
```

---

## Docker Deployment

### Dockerfile

```dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package files
COPY services/mcp-server/package.json ./
COPY services/mcp-server/dist ./dist/

# Install dependencies
RUN npm install --production

# Expose port
EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3100/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: '3.8'

services:
  mcp-server:
    build: .
    ports:
      - "3100:3100"
    environment:
      - DMRX_MCP_TRANSPORT=sse
      - DMRX_MCP_PORT=3100
      - DMRX_MCP_HOST=0.0.0.0
      - DMRX_MCP_API_KEY=${DMRX_MCP_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - DMRX_TOOL_SEARCH_ENABLE_SEMANTIC=true
      - DMRX_TOOL_SEARCH_EMBEDDING_PROVIDER=openai
      - DMRX_AUDIT_ENABLED=true
      - DMRX_GUARDRAILS_ENABLED=true
    volumes:
      - ./config:/app/config
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # Optional: Ollama for local embeddings
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama-data:/root/.ollama
    restart: unless-stopped

volumes:
  ollama-data:
```

---

## Kubernetes Deployment

### deployment.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: dmrx-mcp-server
  labels:
    app: dmrx-mcp-server
spec:
  replicas: 2
  selector:
    matchLabels:
      app: dmrx-mcp-server
  template:
    metadata:
      labels:
        app: dmrx-mcp-server
    spec:
      containers:
      - name: mcp-server
        image: dmrx/mcp-server:latest
        ports:
        - containerPort: 3100
        env:
        - name: DMRX_MCP_TRANSPORT
          value: "http"
        - name: DMRX_MCP_PORT
          value: "3100"
        - name: DMRX_MCP_HOST
          value: "0.0.0.0"
        - name: DMRX_MCP_API_KEY
          valueFrom:
            secretKeyRef:
              name: dmrx-secrets
              key: api-key
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: dmrx-secrets
              key: openai-api-key
        - name: DMRX_FEDERATION_ENABLED
          value: "true"
        - name: DMRX_FEDERATION_DISCOVERY_METHOD
          value: "static"
        - name: DMRX_FEDERATION_INSTANCE_ID
          valueFrom:
            fieldRef:
              fieldPath: metadata.name
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3100
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3100
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: dmrx-mcp-server
spec:
  selector:
    app: dmrx-mcp-server
  ports:
  - port: 3100
    targetPort: 3100
  type: ClusterIP
---
apiVersion: v1
kind: Secret
metadata:
  name: dmrx-secrets
type: Opaque
stringData:
  api-key: "your-secret-api-key"
  openai-api-key: "sk-..."
```

---

## Tips

1. **Start Simple**: Begin with minimal config and add features as needed

2. **Use Environment Variables**: Never hardcode secrets in config files

3. **Enable Features Gradually**: Test each feature before enabling in production

4. **Monitor Health**: Always use health checks in production

5. **Backup Configs**: Keep config files in version control (without secrets)