# =============================================================================
# TrialVigil — GCP free-tier Terraform (TEMPLATE)
#
# *** DO NOT APPLY WITHOUT REVIEW. ***
# This is a template for human review and `terraform plan` ONLY.
# No deployment was performed by the agent that wrote this file, and none
# should be performed without a human reviewing the plan, confirming the
# billing account, and accepting the cost notes in README.md.
#
#   terraform init && terraform plan     # safe: read-only, no resources created
#   terraform apply                      # ONLY after human review + approval
#
# Profile: GCP FREE TIER, region us-central1 (see variables.tf).
# Scope: Cloud Run (console + harness), Artifact Registry, Cloud Storage,
# Secret Manager placeholder, VPC with private subnets, billing budget.
# Deliberately NOT provisioned: Cloud SQL (see comment below).
# =============================================================================

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# -----------------------------------------------------------------------------
# APIs
# -----------------------------------------------------------------------------
resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "storage.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "compute.googleapis.com",
    "billingbudgets.googleapis.com",
  ])
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

# -----------------------------------------------------------------------------
# VPC — private subnets, no public ingress except via Cloud Run's managed
# ingress. Cloud Run services below use ingress = "INGRESS_TRAFFIC_INTERNAL_AND_CLOUD_LOAD_BALANCING"
# so they are NOT directly reachable from the public internet; access goes
# through an internal load balancer (not yet implemented — see README).
# -----------------------------------------------------------------------------
resource "google_compute_network" "main" {
  name                    = "${var.name_prefix}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
  depends_on              = [google_project_service.apis]
}

resource "google_compute_subnetwork" "private" {
  name          = "${var.name_prefix}-private"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.main.id
  ip_cidr_range = var.private_subnet_cidr

  # Private Google Access: lets Cloud Run / VPC-connector workloads reach
  # Google APIs (Storage, Artifact Registry, Secret Manager) without a
  # public IP.
  private_ip_google_access = true
}

# Serverless VPC Access connector so Cloud Run can reach the private subnet.
resource "google_vpc_access_connector" "main" {
  name           = "${var.name_prefix}-connector"
  project        = var.project_id
  region         = var.region
  network        = google_compute_network.main.name
  ip_cidr_range  = var.vpc_connector_cidr
  min_instances  = 2
  max_instances  = 3
  depends_on     = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Artifact Registry — container images for console + harness
# -----------------------------------------------------------------------------
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "${var.name_prefix}-images"
  project       = var.project_id
  format        = "DOCKER"
  description   = "TrialVigil container images (console + harness-service)"
  depends_on    = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Cloud Storage — private bucket for the file/JSON store + audit exports.
# No public access; uniform bucket-level access; versioning on for audit
# safety. (Free tier includes 5 GB of regional standard storage.)
# -----------------------------------------------------------------------------
resource "google_storage_bucket" "data" {
  name                        = "${var.project_id}-${var.name_prefix}-data"
  location                    = var.region
  project                     = var.project_id
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true
  force_destroy               = false

  versioning {
    enabled = true
  }

  public_access_prevention = "enforced"

  lifecycle_rule {
    action {
      type = "Delete"
    }
    condition {
      age = 365
    }
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Secret Manager — placeholder secret. The VALUE must be set by a human
# (e.g. `gcloud secrets versions add ...`) — never commit a real secret here.
# Not yet implemented: wiring the harness to read this secret at runtime.
# -----------------------------------------------------------------------------
resource "google_secret_manager_secret" "app_secret" {
  secret_id = "${var.name_prefix}-app-secret"
  project   = var.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis]
}

# -----------------------------------------------------------------------------
# Cloud Run — console (port 3000) and harness (port 3001)
# Free-tier profile: scale-to-zero (min_instances = 0), 1 vCPU, 512 MiB.
# Cloud Run's free tier covers 2M requests/month; scale-to-zero means no
# charge while idle. Ingress restricted to internal + Cloud Load Balancing.
# -----------------------------------------------------------------------------
resource "google_cloud_run_v2_service" "harness" {
  name     = "${var.name_prefix}-harness"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_INTERNAL_AND_CLOUD_LOAD_BALANCING"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}/harness-service:${var.image_tag}"
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      ports {
        container_port = 3001
      }
      env {
        name  = "PORT"
        value = "3001"
      }
      env {
        name  = "DATA_DIR"
        value = "/data"
      }
      env {
        name  = "OLLAMA_HOST"
        value = ""
      }
    }
    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service" "console" {
  name     = "${var.name_prefix}-console"
  location = var.region
  project  = var.project_id
  ingress  = "INGRESS_TRAFFIC_INTERNAL_AND_CLOUD_LOAD_BALANCING"

  template {
    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }
    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}/console:${var.image_tag}"
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      ports {
        container_port = 3000
      }
      env {
        name  = "PORT"
        value = "3000"
      }
      env {
        name  = "HARNESS_URL"
        value = google_cloud_run_v2_service.harness.uri
      }
    }
    vpc_access {
      connector = google_vpc_access_connector.main.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
  }

  depends_on = [google_project_service.apis]
}

# NOTE: no google_cloud_run_v2_service_iam_binding granting allUsers /
# allAuthenticatedUsers invoker access is defined here on purpose. Public
# access is a human decision after the load balancer + IAP/OIDC front door
# is in place (see docs/iam-vpc.md). Until then these services are
# internal-only.

# -----------------------------------------------------------------------------
# Cloud SQL — DELIBERATELY NOT PROVISIONED
# -----------------------------------------------------------------------------
# There is NO Always Free tier for Cloud SQL. The smallest Cloud SQL
# instance (db-f1-micro / db-g1-small) is a paid resource, so it is the
# FIRST PAID GRADUATION ITEM when the pilot outgrows the local file store.
# For evaluation only, Postgres runs in a container on the free VM
# (1 e2-micro in the free tier) alongside the local JSON store — see
# docs/local-vs-cloud.md. Do not add google_sql_database_instance here
# without a budget decision and a human-approved cost review.

# -----------------------------------------------------------------------------
# Billing budget + alert — cost guardrail (does NOT cap spend by itself;
# it only notifies). Set alert thresholds in variables.tf.
# -----------------------------------------------------------------------------
resource "google_billing_budget" "guardrail" {
  count           = var.billing_account_id != "" ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "${var.name_prefix} monthly budget"

  budget_filter {
    projects = ["projects/${var.project_id}"]
  }

  amount {
    specified_amount {
      currency_code = "USD"
      units         = tostring(var.monthly_budget_usd)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }

  # all_updates_rule is only set when notification channels are provided;
  # otherwise budget alerts go to billing admins by default.
  dynamic "all_updates_rule" {
    for_each = length(var.alert_notification_channels) > 0 ? [1] : []
    content {
      monitoring_notification_channels = var.alert_notification_channels
    }
  }

  depends_on = [google_project_service.apis]
}
