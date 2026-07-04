# DMR-X AWS Terraform Module

Deploy DMR-X on AWS using ECS Fargate with ALB, auto-scaling, and CloudWatch logging.

## Architecture

```
Internet → ALB (HTTPS) → ECS Fargate (Gateway) → CloudWatch Logs
                         ↘ SSM Parameters (secrets)
```

## Prerequisites

- Terraform >= 1.0
- AWS CLI configured
- ACM certificate for HTTPS
- Domain name (optional, for Route53)

## Quick Start

```bash
# Initialize Terraform
cd infra/terraform/aws
terraform init

# Create a terraform.tfvars file
cat > terraform.tfvars << EOF
aws_region          = "us-east-1"
environment         = "dev"
acm_certificate_arn = "arn:aws:acm:us-east-1:123456789012:certificate/abc-123"
admin_api_key       = "your-admin-api-key"
encryption_key      = "your-64-hex-encryption-key"
EOF

# Plan and apply
terraform plan
terraform apply
```

## Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `aws_region` | AWS region | `us-east-1` |
| `project_name` | Project name | `dmr-x` |
| `environment` | Environment (dev/staging/prod) | `dev` |
| `gateway_image` | Docker image | `ghcr.io/danny-dis/dmr-x:latest` |
| `task_cpu` | Fargate CPU units | `1024` |
| `task_memory` | Fargate memory (MiB) | `2048` |
| `desired_count` | Initial task count | `1` |
| `min_count` | Min tasks (autoscaling) | `1` |
| `max_count` | Max tasks (autoscaling) | `4` |
| `acm_certificate_arn` | ACM cert ARN (required) | — |
| `admin_api_key` | Admin API key (required) | — |
| `encryption_key` | Encryption key (required) | — |

## Outputs

| Output | Description |
|--------|-------------|
| `alb_dns_name` | ALB DNS name |
| `gateway_url` | Gateway URL (HTTPS) |
| `ecs_cluster_name` | ECS cluster name |
| `cloudwatch_log_group` | Log group name |

## Production Deployment

For production, override defaults in `terraform.tfvars`:

```hcl
environment         = "prod"
task_cpu            = 2048
task_memory         = 4096
desired_count       = 2
min_count           = 2
max_count           = 10
log_retention_days  = 90
```

## Cleanup

```bash
terraform destroy
```
