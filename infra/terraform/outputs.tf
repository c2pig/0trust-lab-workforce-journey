output "pages_project_name" {
  description = "Cloudflare Pages project name for wrangler-action deployment."
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

output "entra_ext_client_id" {
  description = "Provisioned Entra External ID App Registration Client ID."
  value       = module.entra_external_ciam.entra_ext_client_id
}

output "privileged_group_id" {
  description = "Provisioned Entra External ID 15-minute JIT privileged group object ID."
  value       = module.entra_external_ciam.privileged_group_id
}
