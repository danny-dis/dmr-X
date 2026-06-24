# Phase 3: Kubernetes Operator & Advanced Workflow Orchestration

## Overview

Phase 3 introduces enterprise-grade deployment and orchestration capabilities for DMR-X:

1. **Kubernetes Operator** - Automated management of MCP servers, federation, and tool search indices
2. **Helm Chart** - Production-ready Kubernetes deployment
3. **Advanced Workflow Engine** - Multi-step operation orchestration with parallel execution
4. **Workflow API** - REST API for workflow management

## Kubernetes Operator

The DMR-X Operator manages Custom Resources in Kubernetes:

### Custom Resources

| Resource | Description |
|----------|-------------|
| `MCPServer` | Manages MCP server instances with tool search, OAuth, guardrails, audit, RBAC, and federation |
| `Federation` | Configures federation between DMR-X instances |
| `Workflow` | Defines and executes multi-step workflows |
| `ToolSearchIndex` | Manages tool search indices with BM25, semantic, and hybrid search |

### Example MCPServer Resource

```yaml
apiVersion: dmrx.io/v1
kind: MCPServer
metadata:
  name: my-mcp-server
  namespace: dmr-x
spec:
  replicas: 3
  image: ghcr.io/danny-dis/dmr-x:latest
  toolSearch:
    enabled: true
    bm25: true
    semantic: true
  oauth:
    enabled: true
    issuerUrl: https://auth.example.com
  guardrails:
    enabled: true
    pii: true
    contentFilter: true
  audit:
    enabled: true
    backend: sqlite
  rbac:
    enabled: true
  federation:
    enabled: true
    peers:
      - https://peer1.example.com
      - https://peer2.example.com
```

### Example Federation Resource

```yaml
apiVersion: dmrx.io/v1
kind: Federation
metadata:
  name: my-federation
  namespace: dmr-x
spec:
  peers:
    - name: peer1
      endpoint: https://peer1.example.com
      secretRef: peer1-secret
    - name: peer2
      endpoint: https://peer2.example.com
      secretRef: peer2-secret
  discovery:
    mdns: false
    dns:
      domain: example.com
  syncInterval: 5m
```

### Example Workflow Resource

```yaml
apiVersion: dmrx.io/v1
kind: Workflow
metadata:
  name: my-workflow
  namespace: dmr-x
spec:
  steps:
    - name: fetch-data
      tool: http-fetch
      input:
        url: https://api.example.com/data
    - name: process-data
      tool: data-processor
      input:
        data: "${fetch-data.output}"
      dependsOn:
        - fetch-data
    - name: store-results
      tool: database-write
      input:
        table: results
        data: "${process-data.output}"
      dependsOn:
        - process-data
  variables:
    environment: production
  timeout: 10m
  retryPolicy:
    maxRetries: 3
    backoffMultiplier: 2
```

## Helm Chart

The Helm chart provides production-ready Kubernetes deployment:

### Installation

```bash
# Add the DMR-X Helm repository
helm repo add dmr-x https://charts.dmrx.io
helm repo update

# Install DMR-X
helm install dmr-x dmr-x/dmr-x \
  --namespace dmr-x \
  --create-namespace \
  --set dmrx.adminApiKey=your-admin-key \
  --set dmrx.encryptionKey=your-encryption-key \
  --set dmrx.corsOrigin=https://your-domain.com
```

### Configuration

Key configuration options:

```yaml
# values.yaml
replicaCount: 3

image:
  repository: ghcr.io/danny-dis/dmr-x
  tag: "latest"

dmrx:
  environment: production
  logLevel: info
  localMode: false
  adminApiKey: ""
  encryptionKey: ""
  corsOrigin: "*"

mcpServer:
  enabled: true
  port: 3001
  toolSearch:
    enabled: true
  oauth:
    enabled: false
  guardrails:
    enabled: true
  audit:
    enabled: true
  rbac:
    enabled: true
  a2a:
    enabled: true
  federation:
    enabled: false

workflow:
  enabled: true
  maxConcurrentWorkflows: 10
  defaultTimeout: 300000

autoscaling:
  enabled: true
  minReplicas: 2
  maxReplicas: 10
  targetCPUUtilizationPercentage: 80
```

### Production Deployment

```bash
# Production deployment with monitoring
helm install dmr-x dmr-x/dmr-x \
  --namespace dmr-x \
  --create-namespace \
  -f values-production.yaml \
  --set dmrx.adminApiKey=$(kubectl get secret dmr-x-secrets -o jsonpath='{.data.admin-api-key}' | base64 -d) \
  --set dmrx.encryptionKey=$(kubectl get secret dmr-x-secrets -o jsonpath='{.data.encryption-key}' | base64 -d)
```

## Advanced Workflow Engine

The workflow engine provides advanced orchestration capabilities:

### Features

- **Parallel Execution** - Execute independent steps in parallel
- **Dependency Graphs** - Define step dependencies with `dependsOn`
- **Conditional Branching** - Execute steps based on conditions
- **Retry Policies** - Configure retry logic with exponential backoff
- **Variable Interpolation** - Use `${variable}` syntax in step inputs
- **Timeout Handling** - Set timeouts for workflows and individual steps
- **State Persistence** - Track workflow state and results

### Workflow Definition

```typescript
const workflow: WorkflowDefinition = {
  id: "data-pipeline",
  name: "Data Processing Pipeline",
  steps: [
    {
      id: "fetch",
      name: "Fetch Data",
      tool: "http-fetch",
      input: {
        url: "https://api.example.com/data",
      },
    },
    {
      id: "validate",
      name: "Validate Data",
      tool: "data-validator",
      input: {
        data: "${fetch.output}",
        schema: "user-schema",
      },
      dependsOn: ["fetch"],
    },
    {
      id: "transform",
      name: "Transform Data",
      tool: "data-transformer",
      input: {
        data: "${validate.output}",
        rules: "transform-rules",
      },
      dependsOn: ["validate"],
    },
    {
      id: "store",
      name: "Store Results",
      tool: "database-write",
      input: {
        table: "processed-data",
        data: "${transform.output}",
      },
      dependsOn: ["transform"],
    },
  ],
  variables: {
    environment: "production",
  },
  timeout: 600000, // 10 minutes
};
```

### Workflow API

#### Create and Execute Workflow

```bash
curl -X POST https://api.example.com/workflows \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "definition": {
      "id": "my-workflow",
      "name": "My Workflow",
      "steps": [
        {
          "id": "step1",
          "name": "Step 1",
          "tool": "tool-a",
          "input": { "key": "value" }
        }
      ]
    },
    "variables": {
      "env": "production"
    }
  }'
```

Response:
```json
{
  "workflowId": "my-workflow",
  "status": "accepted",
  "message": "Workflow execution started"
}
```

#### Get Workflow Status

```bash
curl https://api.example.com/workflows/my-workflow \
  -H "Authorization: Bearer your-api-key"
```

Response:
```json
{
  "workflowId": "my-workflow",
  "status": "completed",
  "startTime": "2024-01-01T00:00:00Z",
  "completionTime": "2024-01-01T00:01:00Z",
  "results": {
    "step1": { "success": true, "output": "..." }
  },
  "variables": {
    "env": "production"
  }
}
```

#### Cancel Workflow

```bash
curl -X DELETE https://api.example.com/workflows/my-workflow \
  -H "Authorization: Bearer your-api-key"
```

#### List All Workflows

```bash
curl https://api.example.com/workflows \
  -H "Authorization: Bearer your-api-key"
```

#### Validate Workflow Definition

```bash
curl -X POST https://api.example.com/workflows/validate \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your-api-key" \
  -d '{
    "definition": {
      "id": "my-workflow",
      "name": "My Workflow",
      "steps": [...]
    }
  }'
```

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Kubernetes Cluster                      │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ DMR-X       │  │ DMR-X       │  │ DMR-X       │        │
│  │ Gateway     │  │ Gateway     │  │ Gateway     │        │
│  │ (Primary)   │  │ (Replica)   │  │ (Replica)   │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
│         │                │                │                │
│  ┌──────┴────────────────┴────────────────┴──────┐        │
│  │              DMR-X Operator                    │        │
│  │  ┌─────────────┐  ┌─────────────┐             │        │
│  │  │ MCPServer   │  │ Federation  │             │        │
│  │  │ Controller  │  │ Controller  │             │        │
│  │  └─────────────┘  └─────────────┘             │        │
│  │  ┌─────────────┐  ┌─────────────┐             │        │
│  │  │ Workflow    │  │ ToolSearch  │             │        │
│  │  │ Controller  │  │ Controller  │             │        │
│  │  └─────────────┘  └─────────────┘             │        │
│  └───────────────────────────────────────────────┘        │
│                          │                                │
│  ┌───────────────────────┴───────────────────────┐        │
│  │              Custom Resources                  │        │
│  │  • MCPServer    • Federation                   │        │
│  │  • Workflow     • ToolSearchIndex              │        │
│  └───────────────────────────────────────────────┘        │
└─────────────────────────────────────────────────────────────┘
```

## Monitoring

The Helm chart includes optional monitoring stack:

- **Prometheus** - Metrics collection
- **Grafana** - Dashboards and visualization
- **Loki** - Log aggregation
- **Promtail** - Log shipping

### Metrics

The operator exposes the following metrics:

- `dmrx_workflow_total` - Total workflows executed
- `dmrx_workflow_duration_seconds` - Workflow execution duration
- `dmrx_workflow_steps_total` - Total workflow steps executed
- `dmrx_mcp_server_replicas` - MCP server replica count
- `dmrx_federation_peers_connected` - Connected federation peers

## Next Steps

1. **CRD Validation** - Add OpenAPI schema validation for CRDs
2. **Webhooks** - Add admission webhooks for resource validation
3. **Metrics Export** - Export operator metrics to Prometheus
4. **Dashboard** - Create Grafana dashboard for operator monitoring
5. **CI/CD** - Add GitHub Actions for operator image building
