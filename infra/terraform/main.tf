provider "cloudflare" {}

provider "google" {
  project = var.gcp_project_id
  region  = var.gcp_region
}

module "entra_external_ciam" {
  count  = var.enable_entra_ciam ? 1 : 0
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/entra-external-ciam?ref=v1.0.0"

  tenant_id        = var.entra_ext_tenant_id
  tenant_subdomain = var.entra_ext_tenant_subdomain
}

# Static SPA hosting only (dist/); API traffic is routed by 0trust-lab-router to Cloud Run.
module "cloudflare_pages_lab" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/cloudflare-pages-lab?ref=v1.0.0"

  cloudflare_account_id = var.cloudflare_account_id
  cloudflare_zone_id    = var.cloudflare_zone_id
  state_kv_namespace_id = var.state_kv_namespace_id
  pages_project_name    = "0trust-lab-workforce-journey"
  enable_custom_domain  = false

  plain_env_vars = {
    ENVIRONMENT = var.environment
  }

  secret_env_vars = {}
}

# Cloud Run API backend + Firestore Native state (min_instance_count = 0, $0 idle cost).
module "cloud_run_lab" {
  source = "git::https://github.com/c2pig/managed-infrastructure.git//modules/cloud-run-lab?ref=v1.0.0"

  gcp_project_id                 = var.gcp_project_id
  gcp_region                     = var.gcp_region
  lab_slug                       = "workforce-journey"
  image                          = var.cloud_run_image
  environment                    = var.environment
  firestore_collection           = var.firestore_collection
  lab_router_secret_id           = var.lab_router_secret_id
  deployer_service_account_email = var.deployer_service_account_email

  plain_env_vars = merge(
    var.pam_api_url != "" ? { PAM_API_URL = var.pam_api_url } : {},
    var.otlp_endpoint != "" ? { OTLP_ENDPOINT = var.otlp_endpoint } : {},
    var.enable_entra_ciam ? {
      ENTRA_EXT_TENANT_ID = module.entra_external_ciam[0].entra_ext_tenant_id
      ENTRA_EXT_CLIENT_ID = module.entra_external_ciam[0].entra_ext_client_id
      ENTRA_EXT_AUTHORITY = module.entra_external_ciam[0].entra_ext_authority
      PRIVILEGED_GROUP_ID = module.entra_external_ciam[0].privileged_group_id
    } : {}
  )

  secret_env_vars = merge(
    var.lab1_jwt_secret_id != "" ? { LAB1_JWT_SECRET = var.lab1_jwt_secret_id } : {},
    var.pam_api_token_secret_id != "" ? { PAM_API_TOKEN = var.pam_api_token_secret_id } : {},
    var.enable_entra_ciam && var.entra_ext_client_secret_id != "" ? {
      ENTRA_EXT_CLIENT_SECRET = var.entra_ext_client_secret_id
    } : {},
    var.otlp_auth_header_secret_id != "" ? { OTLP_AUTH_HEADER = var.otlp_auth_header_secret_id } : {}
  )
}
