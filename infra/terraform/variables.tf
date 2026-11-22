variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare Account ID (from managed-infrastructure stacks/global/cloudflare/platform)."
}

variable "cloudflare_zone_id" {
  type        = string
  description = "Cloudflare Zone ID for 0trust.dev."
}

variable "state_kv_namespace_id" {
  type        = string
  description = "Shared STATE_KV namespace ID for Lab 1 SCIM/JIT/revocation state."
}

variable "environment" {
  type        = string
  default     = "production"
  description = "Deployment environment label bound to ENVIRONMENT."
}

variable "enable_entra_ciam" {
  type        = bool
  default     = false
  description = "Whether to provision a dedicated Entra External ID CIAM app via managed-infrastructure."
}

variable "entra_ext_tenant_id" {
  type        = string
  default     = ""
  description = "Microsoft Entra External ID (CIAM) Tenant ID (GUID)."
}

variable "entra_ext_tenant_subdomain" {
  type        = string
  default     = ""
  description = "Microsoft Entra External ID (CIAM) tenant subdomain."
}

variable "pam_api_url" {
  type        = string
  default     = ""
  description = "Optional iam-demo PAM API base URL for external JIT sync."
}

variable "pam_api_token" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional iam-demo PAM API bearer token."
}

variable "lab1_jwt_secret" {
  type        = string
  default     = ""
  sensitive   = true
  description = "Optional HMAC secret for signing Lab 1 edge session and JIT JWTs."
}
