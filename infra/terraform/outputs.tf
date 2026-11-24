output "pages_project_name" {
  description = "Cloudflare Pages project name for static SPA deployment."
  value       = module.cloudflare_pages_lab.pages_project_name
}

output "pages_subdomain" {
  description = "Default Cloudflare Pages subdomain."
  value       = module.cloudflare_pages_lab.pages_subdomain
}

output "lab_url" {
  description = "Production Model 1 custom domain URL."
  value       = module.cloudflare_pages_lab.lab_url
}

output "cloud_run_service_name" {
  description = "GCP Cloud Run service name powering /api/workforce-journey/*."
  value       = module.cloud_run_lab.service_name
}

output "cloud_run_service_uri" {
  description = "GCP Cloud Run service origin URI (configured in 0trust-lab-router)."
  value       = module.cloud_run_lab.service_uri
}

output "cloud_run_service_account_email" {
  description = "Least-privilege GCP runtime service account email for Lab 1."
  value       = module.cloud_run_lab.service_account_email
}

output "entra_ext_client_id" {
  description = "Provisioned Entra External ID App Registration Client ID."
  value       = var.enable_entra_ciam ? module.entra_external_ciam[0].entra_ext_client_id : null
}

output "privileged_group_id" {
  description = "Provisioned Entra External ID 15-minute JIT privileged group object ID."
  value       = var.enable_entra_ciam ? module.entra_external_ciam[0].privileged_group_id : null
}
