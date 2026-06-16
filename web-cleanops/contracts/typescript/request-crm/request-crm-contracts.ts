export type RequestStatus =
  | 'new'
  | 'open'
  | 'in_progress'
  | 'waiting_customer'
  | 'waiting_employee'
  | 'waiting_internal'
  | 'action_planned'
  | 'resolved'
  | 'closed'
  | 'reopened';

export type RequestPriority = 'low' | 'normal' | 'high';
export type RequestSeverity = 'normal' | 'prio' | 'emergency';
export type ActorType = 'admin' | 'customer' | 'employee' | 'ai' | 'system';
export type ThreadType = 'customer' | 'employee' | 'shared_customer_employee' | 'internal' | 'ai_intake';

export interface RequestListItem {
  id: string;
  requestNumber: string;
  title: string;
  status: RequestStatus;
  priority: RequestPriority;
  severity: RequestSeverity;
  categoryId?: string | null;
  ownerAdminId?: string | null;
  customerId?: string | null;
  hasUnreadExternal: boolean;
  hasUnacknowledgedInternalTask: boolean;
  automationQuickReviewKey?: string | null;
  isTestData: boolean;
  testBatchId?: string;
}

export interface RequestDomainEvent {
  key: string;
  sourceModule: string;
  tenantId: string;
  linkedObjectType: string;
  linkedObjectId: string;
  correlationId?: string;
  payload: Record<string, unknown>;
  isTestData?: boolean;
  testBatchId?: string | null;
  createdAt: string;
}

export interface AutomationQuickReview {
  centralActionKey: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  aiExtensionCandidate: boolean;
  sourceOfTruth: 'Automation & AI Center';
  slice0Behavior: 'mock/read-only' | string;
}

export interface RuntimeSafetyMockStatus {
  surface: string;
  status: 'mock_ok' | 'mock_warning' | 'mock_disabled';
  latencyBudgetMs: number;
  runtimeFlagRef: string;
  sourceOfTruth: 'Automation & AI Center';
  slice0Behavior: 'display only';
}
