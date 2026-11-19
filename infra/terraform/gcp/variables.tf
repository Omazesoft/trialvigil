# TrialVigil — GCP free-tier Terraform variables.
# Fill in project_id (and billing_account_id for the budget guardrail) via
# a tfvars file or environment variables. Never commit real IDs/secrets.

variable "project_id" {
  description = "GCP project ID to deploy into."
  type        = string
}

variable "region" {
  description = "GCP region. us-central1 is the free-tier region for e2-micro."
  type        = string
  default     = "us-central1"
}

variable "name_prefix" {
  description = "Prefix for all resource names."
  type        = string
  default     = "trialvigil"
}

variable "image_tag" {
  description = "Container image tag in Artifact Registry (console + harness-service)."
  type        = string
  default     = "latest"
}

variable "max_instances" {
  description = "Max Cloud Run instances per service (keeps free-tier usage bounded)."
  type        = number
  default     = 2
}

variable "private_subnet_cidr" {
  description = "CIDR for the private VPC subnet."
  type        = string
  default     = "10.10.0.0/24"
}

variable "vpc_connector_cidr" {
  description = "CIDR for the Serverless VPC Access connector (must be a /28)."
  type        = string
  default     = "10.10.1.0/28"
}

variable "billing_account_id" {
  description = "Billing account ID (e.g. 000000-000000-000000). Leave empty to skip the billing budget resource."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly budget cap (USD) for the billing-budget guardrail. This only alerts — it does not stop spend."
  type        = number
  default     = 10
}

variable "alert_notification_channels" {
  description = "Monitoring notification channel IDs for budget alerts (empty = email to billing admins only)."
  type        = list(string)
  default     = []
}
