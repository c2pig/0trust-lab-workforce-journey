module "entra_external_ciam" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/entra-external-ciam?ref=main"

  tenant_id        = var.entra_ext_tenant_id
  tenant_subdomain = var.entra_ext_tenant_subdomain
}

module "cloudflare_pages_lab" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/cloudflare-pages-lab?ref=main"

  cloudflare_account_id = var.cloudflare_account_id
  cloudflare_zone_id    = var.cloudflare_zone_id
  state_kv_namespace_id = var.state_kv_namespace_id
  pages_project_name    = "0trust-lab-workforce-journey"
  subdomain_prefix      = "workforce-journey.lab"

  plain_env_vars = {
    ENVIRONMENT         = var.environment
    ENTRA_EXT_TENANT_ID = module.entra_external_ciam.entra_ext_tenant_id
    ENTRA_EXT_CLIENT_ID = module.entra_external_ciam.entra_ext_client_id
    ENTRA_EXT_AUTHORITY = module.entra_external_ciam.entra_ext_authority
    PRIVILEGED_GROUP_ID = module.entra_external_ciam.privileged_group_id
    PAM_API_URL         = var.pam_api_url
  }

  secret_env_vars = {
    ENTRA_EXT_CLIENT_SECRET = module.entra_external_ciam.entra_ext_client_secret
    PAM_API_TOKEN           = var.pam_api_token
    LAB1_JWT_SECRET         = var.lab1_jwt_secret
  }
}
