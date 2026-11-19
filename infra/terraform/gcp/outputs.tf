output "console_service_name" {
  description = "Cloud Run service name for the console."
  value       = google_cloud_run_v2_service.console.name
}

output "console_uri" {
  description = "Internal URI of the console Cloud Run service (not public until a load balancer + auth front door is added)."
  value       = google_cloud_run_v2_service.console.uri
}

output "harness_service_name" {
  description = "Cloud Run service name for the harness service."
  value       = google_cloud_run_v2_service.harness.name
}

output "harness_uri" {
  description = "Internal URI of the harness Cloud Run service."
  value       = google_cloud_run_v2_service.harness.uri
}

output "artifact_registry_repo" {
  description = "Artifact Registry repository for container images."
  value       = google_artifact_registry_repository.images.name
}

output "data_bucket" {
  description = "Private Cloud Storage bucket for the file store + audit exports."
  value       = google_storage_bucket.data.name
}

output "vpc_name" {
  description = "VPC network name."
  value       = google_compute_network.main.name
}

output "private_subnet" {
  description = "Private subnet name."
  value       = google_compute_subnetwork.private.name
}

output "secret_name" {
  description = "Secret Manager placeholder secret (value must be set by a human)."
  value       = google_secret_manager_secret.app_secret.secret_id
}
