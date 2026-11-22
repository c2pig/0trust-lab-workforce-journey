export interface ObservabilitySpan {
  id: string;
  traceparent: string;
  trace_id: string;
  span_id: string;
  parent_span_id: string;
  session_id: string;
  method: string;
  path: string;
  status: number;
  latency_ms: number;
  timestamp: string;
  otlp_export: 'configured' | 'in-lab-only';
  redacted_auth_header: string | null;
  redaction_applied: boolean;
  execution_origin: 'cloudflare-edge' | 'browser-webcrypto-fallback';
  response_summary: Record<string, unknown>;
}

export type WorkforceJourneyPersonaId =
  | 'alex-chen'
  | 'sarah-lin'
  | 'jordan-patel'
  | 'maya-lin'
  | 'marcus-chen'
  | 'priya-nair';

export type WorkforceJourneyRole = 'Viewer' | 'Payment Creator' | 'Audit Approver';

export interface WorkforceJourneyScimRecord {
  schemas: string[];
  id: string;
  userName: string;
  displayName: string;
  department: string;
  active: boolean;
  status: 'ACTIVE' | 'REVOKED';
  roles: string[];
  active_jtis: string[];
  provisioned_at: string;
  revoked_at?: string;
  idp_adapter: string;
  entra_oid?: string;
  privileged_group_active?: boolean;
  graph_request_id?: string;
}

export interface WorkforceJourneyDecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
}

export type WorkforceJourneyJitRequestStatus = 'PENDING' | 'APPROVED' | 'DENIED';

export type WorkforceJourneyJitDecisionAction = 'approve' | 'deny' | 'grant_permanent';

export interface WorkforceJourneyJitRequestRecord {
  request_id: string;
  session_id: string;
  status: WorkforceJourneyJitRequestStatus;
  requester: {
    sub: string;
    email: string;
    name: string;
    department: string;
    base_roles: string[];
    session_jti: string;
    entra_oid?: string;
  };
  requested_roles: string[];
  requested_scope: 'admin:temp';
  justification: string;
  ttl_seconds: number;
  sod_check: {
    rule_id: 'SOD-FIN-001';
    status: 'PASS';
    checked_at: string;
  };
  idp_mode: 'edge-webcrypto' | 'entra-external-id';
  created_at: string;
  decided_at?: string;
  decided_by?: string;
  decision_reason?: string;
  jit_jti?: string;
}

export interface WorkforceJourneyJitSubmitData {
  status?: 'PENDING' | string;
  error?: string;
  code?: string;
  rule_id?: string;
  policy?: string;
  message?: string;
  request_id?: string;
  sod_status?: 'PASS' | 'FAIL' | string;
  ttl_seconds?: number;
  kv_ttl_seconds?: number;
  max_ttl_seconds?: number;
  requested_ttl_seconds?: number;
  conflicting_roles?: string[];
  existing_roles?: string[];
  requested_roles?: string[];
  storage?: string;
  idp_mode?: string;
  request?: WorkforceJourneyJitRequestRecord;
}

export interface WorkforceJourneyJitDecisionData {
  status?: 'JIT_GRANTED' | 'JIT_DENIED' | string;
  error?: string;
  code?: string;
  policy?: string;
  rule_id?: string;
  message?: string;
  request_id?: string;
  approved_by?: string;
  approved_by_name?: string;
  denied_by?: string;
  denied_by_name?: string;
  reason?: string;
  justification?: string;
  expires_in?: number;
  jit_jwt?: string;
  decoded_claims?: WorkforceJourneyDecodedJwt;
  scim_record?: WorkforceJourneyScimRecord | null;
  idp_mode?: string;
  storage?: string;
  external_sync?: string;
  graph_request_id?: string;
  pam_api_status?: string;
  request?: WorkforceJourneyJitRequestRecord;
}
