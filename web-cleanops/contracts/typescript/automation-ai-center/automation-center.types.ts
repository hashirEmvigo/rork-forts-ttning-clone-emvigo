export type AutomationModuleKey =
  | 'schedule'
  | 'cases'
  | 'chat'
  | 'notifications'
  | 'keys_alarm'
  | 'customer_card'
  | 'work_orders'
  | 'invoices'
  | 'media'
  | 'time_bank'
  | 'agreements'
  | 'employees'
  | 'system';

export type AutomationActionStatus = 'draft' | 'planned' | 'active' | 'disabled' | 'deprecated';

export type AutomationRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type AutomationExecutionMode =
  | 'observe_only'
  | 'auto_execute_with_log'
  | 'auto_execute_with_notification'
  | 'requires_admin_review'
  | 'requires_company_admin_approval'
  | 'requires_super_admin_approval'
  | 'blocked';

export type AutomationExecutionStatus =
  | 'detected'
  | 'evaluating'
  | 'skipped'
  | 'pending_approval'
  | 'proposed'
  | 'executed'
  | 'failed'
  | 'cancelled'
  | 'rate_limited'
  | 'blocked_by_guard'
  | 'circuit_open'
  | 'timed_out';

export type AiMode =
  | 'none'
  | 'summarize_only'
  | 'suggest_only'
  | 'draft_only'
  | 'prepare_approval'
  | 'limited_auto_execute';

export type AutomationApprovalPolicy = {
  required: boolean;
  requiredRole?: 'admin' | 'company_admin' | 'super_admin' | null;
  allowEditBeforeApproval: boolean;
  allowReject: boolean;
  allowAutoExecuteAfterApproval: boolean;
  reasonRequiredOnReject: boolean;
};

export type AutomationTriggerDefinition = {
  type: 'domain_event' | 'scheduled_check' | 'manual_test' | 'state_change' | 'webhook' | 'system_health';
  eventKey?: string;
  schedule?: string;
  sourceEntityTypes: string[];
};

export type AutomationConditionDefinition = {
  key: string;
  description: string;
  type:
    | 'threshold'
    | 'boolean'
    | 'state_match'
    | 'time_window'
    | 'customer_preference'
    | 'data_missing'
    | 'custom_domain_check';
  config: Record<string, unknown>;
};

export type AutomationActionStepDefinition = {
  key: string;
  description: string;
  type:
    | 'create_log'
    | 'create_notification'
    | 'update_estimate'
    | 'create_case'
    | 'update_status'
    | 'send_customer_app_notification'
    | 'create_approval_request'
    | 'create_ai_proposal'
    | 'call_domain_service'
    | 'apply_runtime_guard'
    | 'no_op';
  target: 'internal' | 'customer' | 'employee' | 'admin' | 'domain_service' | 'ai_extension' | 'runtime_guard';
  config: Record<string, unknown>;
};

export type ResourceProfile = 'light' | 'medium' | 'heavy' | 'critical';

export type AutomationAction = {
  id: string;
  key: string;
  name: string;
  description: string;
  module: AutomationModuleKey;
  ownerDomain: AutomationModuleKey;
  trigger: AutomationTriggerDefinition;
  conditions: AutomationConditionDefinition[];
  actions: AutomationActionStepDefinition[];
  status: AutomationActionStatus;
  riskLevel: AutomationRiskLevel;
  executionMode: AutomationExecutionMode;
  approvalPolicy: AutomationApprovalPolicy;
  supportsAi: boolean;
  aiEnabled: boolean;
  resourceProfile?: ResourceProfile;
  safetyLimitKeys?: string[];
  runtimeGuardPolicyKeys?: string[];
  featureFlagKey?: string | null;
  circuitBreakerKey?: string | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  version: number;
  tags: string[];
  latestRunAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AiActionExtension = {
  id: string;
  automationActionKey: string;
  assistantKey: string;
  aiMode: AiMode;
  allowedOutputs: string[];
  requiredContext: Array<{
    source: AutomationModuleKey;
    fields: string[];
    required: boolean;
    piiRisk: 'none' | 'low' | 'medium' | 'high';
  }>;
  approvalPolicy: AutomationApprovalPolicy;
  enabled: boolean;
  requestBudgetKey?: string | null;
  tokenBudgetKey?: string | null;
  timeoutMs?: number | null;
  maxRetries?: number | null;
  providerCircuitBreakerKey?: string | null;
  modelConfigKey?: string | null;
  promptVersion?: string | null;
};

export type ModuleCoverage = {
  module: AutomationModuleKey;
  displayName: string;
  integrationStatus: 'not_started' | 'planned' | 'partial' | 'ready' | 'active';
  plannedActions: number;
  activeActions: number;
  aiCapableActions: number;
  aiEnabledActions: number;
  quickReviewStatus: 'none' | 'planned' | 'available';
  runtimeSafetyStatus?: 'not_started' | 'planned' | 'partial' | 'ready' | 'active';
  missingIntegrationPoints: string[];
  lastReviewedAt?: string | null;
};

export type RuntimeGuardScope =
  | 'session'
  | 'user'
  | 'company'
  | 'role'
  | 'module'
  | 'route'
  | 'endpoint'
  | 'automation_action'
  | 'background_job'
  | 'ai_assistant'
  | 'public_surface'
  | 'system';

export type RuntimeLimitType =
  | 'request_count'
  | 'concurrent_requests'
  | 'retry_count'
  | 'polling_frequency'
  | 'realtime_subscriptions'
  | 'payload_size'
  | 'upload_size'
  | 'export_job_count'
  | 'database_row_count'
  | 'query_duration'
  | 'ai_request_count'
  | 'ai_token_budget'
  | 'background_job_concurrency';

export type RuntimeGuardTriggerType =
  | 'rate_limit_exceeded'
  | 'resource_quota_exceeded'
  | 'concurrent_limit_exceeded'
  | 'retry_limit_exceeded'
  | 'frontend_loop_detected'
  | 'polling_frequency_exceeded'
  | 'realtime_reconnect_storm_detected'
  | 'timeout_threshold_exceeded'
  | 'error_rate_threshold_exceeded'
  | 'latency_threshold_exceeded'
  | 'slow_query_detected'
  | 'ai_quota_exceeded'
  | 'upload_limit_exceeded'
  | 'circuit_breaker_opened'
  | 'dependency_health_failed'
  | 'manual_kill_switch';

export type RuntimeGuardActionType =
  | 'log_only'
  | 'throttle'
  | 'limit_data'
  | 'set_read_only'
  | 'disable_feature'
  | 'open_circuit'
  | 'quarantine_session'
  | 'block_request'
  | 'create_incident'
  | 'notify_it_team'
  | 'notify_super_admin'
  | 'require_manual_review'
  | 'fallback_to_cached_or_empty_state';

export type RuntimePolicyStatus = 'draft' | 'planned' | 'active' | 'disabled' | 'deprecated';

export type RuntimeSafetyLimit = {
  id: string;
  key: string;
  name: string;
  description: string;
  module?: AutomationModuleKey | null;
  scope: RuntimeGuardScope;
  limitType: RuntimeLimitType;
  windowSeconds?: number | null;
  threshold: number;
  unit: string;
  guardAction: RuntimeGuardActionType;
  severity: RuntimeIncidentSeverity;
  status: RuntimePolicyStatus;
  appliesToRoutes?: string[];
  appliesToEndpoints?: string[];
  appliesToActionKeys?: string[];
  fallbackBehavior?: string | null;
  createdAt: string;
  updatedAt: string;
};


export type RuntimeGuardPolicy = {
  id: string;
  key: string;
  name: string;
  description: string;
  module?: AutomationModuleKey | null;
  scope: RuntimeGuardScope;
  triggerType: RuntimeGuardTriggerType;
  conditions: AutomationConditionDefinition[];
  riskLevel: AutomationRiskLevel;
  guardActions: RuntimeGuardActionType[];
  safetyLimitKeys: string[];
  runtimeFlagKey?: string | null;
  circuitBreakerKey?: string | null;
  incidentPolicy: {
    createIncident: boolean;
    updateExisting: boolean;
    dedupeWindowSeconds?: number | null;
    severity: RuntimeIncidentSeverity;
  };
  alertPolicy: {
    alertTargets: string[];
    alertOnSeverities: RuntimeIncidentSeverity[];
    createFollowUpTask: boolean;
    followUpOwner?: string | null;
  };
  resolutionPolicy: {
    requiredForSeverities: RuntimeIncidentSeverity[];
    requiresResolutionNotes: boolean;
    requiresRegressionCheck: boolean;
    rollbackPlanRequired: boolean;
  };
  status: RuntimePolicyStatus;
  createdAt: string;
  updatedAt: string;
};

export type RuntimeIncidentSeverity = 'info' | 'warning' | 'high' | 'critical';

export type RuntimeIncidentStatus = 'open' | 'acknowledged' | 'investigating' | 'mitigated' | 'resolved' | 'false_positive';

export type RuntimeIncident = {
  id: string;
  severity: RuntimeIncidentSeverity;
  status: RuntimeIncidentStatus;
  title: string;
  description: string;
  module?: AutomationModuleKey | null;
  route?: string | null;
  endpoint?: string | null;
  companyId?: string | null;
  userId?: string | null;
  sessionId?: string | null;
  actionKey?: string | null;
  runtimeGuardPolicyKey?: string | null;
  triggerType: RuntimeGuardTriggerType;
  guardAction: RuntimeGuardActionType;
  requestCount?: number | null;
  errorCount?: number | null;
  latencyMs?: number | null;
  correlationId?: string | null;
  traceRef?: string | null;
  releaseVersion?: string | null;
  startedAt: string;
  lastSeenAt: string;
  resolvedAt?: string | null;
  assignedTo?: string | null;
  resolutionNotes?: string | null;
};

export type FeatureRuntimeState = 'enabled' | 'limited_mode' | 'read_only' | 'admin_only' | 'maintenance_mode' | 'disabled';

export type FeatureRuntimeFlag = {
  id: string;
  key: string;
  featureName: string;
  module?: AutomationModuleKey | null;
  state: FeatureRuntimeState;
  reason: string;
  changedBy: string;
  changedAt: string;
  linkedIncidentId?: string | null;
  auditRequired: boolean;
};

export type ModuleHealthState = 'healthy' | 'degraded' | 'limited' | 'unhealthy' | 'disabled' | 'maintenance';

export type CircuitBreakerState = 'closed' | 'open' | 'half_open' | 'not_applicable';

export type ModuleHealth = {
  module: AutomationModuleKey;
  displayName: string;
  healthStatus: ModuleHealthState;
  p95LatencyMs?: number | null;
  errorRatePercent?: number | null;
  openIncidents: number;
  circuitBreakerState: CircuitBreakerState;
  runtimeState: FeatureRuntimeState;
  lastCheckedAt: string;
};

export type PerformanceBudgetStatus = 'passing' | 'warning' | 'failing' | 'not_tested';

export type PerformanceBudget = {
  id: string;
  key: string;
  name: string;
  scopeType: 'route' | 'endpoint' | 'module' | 'job' | 'frontend_bundle' | 'database_query' | 'ai_feature';
  module?: AutomationModuleKey | null;
  target: string;
  targetValue: number;
  unit: string;
  currentValue?: number | null;
  status: PerformanceBudgetStatus;
  owner: string;
  lastTestedAt?: string | null;
  notes?: string | null;
};

export type AutomationExecution = {
  id: string;
  actionKey: string;
  actionVersion: number;
  status: AutomationExecutionStatus;
  sourceEventKey?: string;
  sourceEntityType: string;
  sourceEntityId: string;
  triggerPayload: Record<string, unknown>;
  conditionResults: Array<Record<string, unknown>>;
  resultPayload?: Record<string, unknown> | null;
  riskLevel: AutomationRiskLevel;
  approvalRequired: boolean;
  aiUsed: boolean;
  guardAction?: RuntimeGuardActionType | null;
  runtimeIncidentId?: string | null;
  durationMs?: number | null;
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
};
