import { create } from 'zustand';
import { EXPLICIT_PROMPT_THEME_SOURCE, type AssetSelectionMode, type ClarificationAnswer, type ClarificationOption, type Message, type ThinkingEvent } from '@/types/message';
import { conversationNodesToMessages } from '@/chat/conversationToMessages';
import { processingService, type ProcessingResponse } from '@/services/processingService';
import { streamWorkflow } from '@/services/workflowStreamService';
import type { ConversationChatRequest, DashboardDataResponse } from '@/services/conversationService';
import type { AmazonSellerSyncRequest, CustomerIOSyncRequest, GoogleSearchConsoleSyncRequest, KlaviyoSyncRequest, LazadaSellerSyncRequest, MixpanelSyncRequest, PostHogSyncRequest, QuickBooksSyncRequest, ShopifySyncRequest, ShopeeSellerSyncRequest, SupabaseSyncRequest, TikTokShopSellerSyncRequest, ZendeskSyncRequest } from '@/services/integrationService';
import type { AnalysisStep, ChartChangeSummary, EditDataProvenance } from '@/types/chartEdit';
import type { AssetRecord } from '@/services/fileService';
import {
  createThemeSelection,
  resolveAnalysisFocus,
  resolveVisualTheme,
  type ThemeSelection,
} from '@/constants/builtinTemplates';

// Monotonic request counter for selectDashboard. When two dashboard cards
// are clicked in rapid succession, only the latest fetch's result is
// applied; older in-flight resolutions are discarded by request-id check.
let selectDashboardSeq = 0;
let workflowRunSeq = 0;
let activeWorkflowRunId: number | null = null;

function beginWorkflowRun(): number {
  workflowRunSeq += 1;
  activeWorkflowRunId = workflowRunSeq;
  return workflowRunSeq;
}

function invalidateWorkflowRuns(): void {
  workflowRunSeq += 1;
  activeWorkflowRunId = null;
}

function isWorkflowRunActive(runId: number): boolean {
  return activeWorkflowRunId === runId;
}

function finishWorkflowRun(runId: number): void {
  if (activeWorkflowRunId === runId) {
    activeWorkflowRunId = null;
  }
}

// ---------------------------------------------------------------------------
// Per-dashboard visual theme persistence. The old template map is still read
// as a fallback for dashboards generated before the theme/focus split.
// ---------------------------------------------------------------------------
const DASHBOARD_TEMPLATE_MAP_KEY = 'dreamify_dashboard_template_map';
const DASHBOARD_THEME_MAP_KEY = 'dreamify_dashboard_theme_map';
const SELECTED_THEME_KEY = 'dreamify_selected_theme';
const LEGACY_SELECTED_TEMPLATE_KEY = 'dreamify_selected_template';

type SelectedTemplate = ThemeSelection;

function getStorageMap(key: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function saveStorageMapValue(key: string, dashboardId: string, value: string): void {
  try {
    const map = getStorageMap(key);
    map[dashboardId] = value;
    localStorage.setItem(key, JSON.stringify(map));
  } catch { /* ignore */ }
}

function saveDashboardThemeId(dashboardId: string, themeId: string): void {
  saveStorageMapValue(DASHBOARD_THEME_MAP_KEY, dashboardId, themeId);
}

function getThemeIdForDashboard(dashboardId: string): string | null {
  try {
    return getStorageMap(DASHBOARD_THEME_MAP_KEY)[dashboardId] ?? null;
  } catch { return null; }
}

function getLegacyTemplateIdForDashboard(dashboardId: string): string | null {
  try {
    return getStorageMap(DASHBOARD_TEMPLATE_MAP_KEY)[dashboardId] ?? null;
  } catch { return null; }
}

function resolveStoredTheme(
  themeId: string | null,
  analysisFocusId?: string | null,
  legacyTemplateId?: string | null,
): SelectedTemplate | null {
  const resolvedTheme = themeId || legacyTemplateId;
  const resolvedFocus = analysisFocusId || legacyTemplateId;
  return createThemeSelection(resolvedTheme, resolvedFocus);
}

function readPendingThemeSelection(): SelectedTemplate | null {
  try {
    const current = localStorage.getItem(SELECTED_THEME_KEY);
    if (current) {
      const parsed = JSON.parse(current);
      return createThemeSelection(parsed?.id ?? parsed?.suggestedTheme, parsed?.analysisFocusId) ?? null;
    }
    const legacy = localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      return createThemeSelection(parsed?.suggestedTheme ?? parsed?.id, parsed?.id) ?? null;
    }
  } catch { /* ignore */ }
  return null;
}

function persistPendingThemeSelection(selection: SelectedTemplate | null): void {
  try {
    if (selection) {
      localStorage.setItem(SELECTED_THEME_KEY, JSON.stringify(selection));
      localStorage.removeItem(LEGACY_SELECTED_TEMPLATE_KEY);
    } else {
      localStorage.removeItem(SELECTED_THEME_KEY);
      localStorage.removeItem(LEGACY_SELECTED_TEMPLATE_KEY);
    }
  } catch { /* ignore */ }
}

function getThemeId(selection: SelectedTemplate | null): string | undefined {
  const theme = resolveVisualTheme(selection?.suggestedTheme ?? selection?.id);
  return theme?.id;
}

function getAnalysisFocusId(selection: SelectedTemplate | null): string | undefined {
  const focus = resolveAnalysisFocus(selection?.analysisFocusId ?? null);
  return focus?.id;
}

function emitConnectorSynced(connector: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('dreamify:connector-synced', {
      detail: { connector, at: Date.now() },
    })
  );
}


export interface UploadedFile {
  fileID: string;
  filename: string;
  size: number;
  ext: string;
  status: 'uploading' | 'uploaded' | 'processing' | 'processed' | 'error' | 'accepted';
  projectId?: string;
  conversationId?: string;
  processedData?: unknown;
  rowCount?: number;
  columnCount?: number;
  /** Upload progress percentage (0-100) for local file uploads */
  uploadProgress?: number;
  /** True if file was selected from @mention dropdown (already exists in conversation) */
  isFromMention?: boolean;
  /** Integration source type if the file came from an API sync */
  sourceType?: string;
  /** GA4 account display name */
  accountName?: string;
  /** GA4 property display name */
  propertyName?: string;
  /** Human-readable sync version label from connector history */
  syncVersionName?: string;
  /** True when user chose to keep a header-only / zero-row integration export (not sufficient for analysis) */
  schemaOnly?: boolean;
}

type DashboardDataForView = Record<string, unknown> & {
  theme_id?: string | null;
  analysis_focus_id?: string | null;
  template_id?: string | null;
};

type WarehouseConnectorKey = 'postgres' | 'bigquery' | 'snowflake' | 'databricks';

/** Result of Meta Ads sync API (used by Meta modal for empty-data hybrid flow) */
export interface MetaAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Result of TikTok Ads sync API */
export interface TikTokAdsSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: AssetRecord;
  message?: string;
}

/** Files that must not trigger analysis-only flows. */
export function isNonAnalyzableUpload(file: UploadedFile): boolean {
  if (file.schemaOnly) return true;
  if (file.rowCount === 0 && (file.sourceType === 'Meta Ads' || file.sourceType === 'TikTok Ads')) return true;
  return false;
}

export function isFreshPromptUpload(file: UploadedFile): boolean {
  return (
    !file.conversationId &&
    !file.isFromMention &&
    (file.status === 'uploaded' || file.status === 'accepted')
  );
}

export function getExplicitPromptFiles(
  files: UploadedFile[],
  selectedAssetIds: readonly string[] = [],
): UploadedFile[] {
  const selectedIds = new Set(selectedAssetIds.filter(Boolean));
  return files.filter((file) => {
    if (!file.fileID) return false;
    return selectedIds.has(file.fileID) || isFreshPromptUpload(file);
  });
}

function uniqueIds(ids: readonly (string | undefined | null)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
}

interface EditCompletionPayload {
  dashboardId?: string | null;
  dashboardTitle?: string | null;
  sourceFileName?: string;
  accountName?: string;
  sourceType?: string;
  summary?: ChartChangeSummary | null;
  provenance?: EditDataProvenance | null;
  editNote?: string | null;
}

export function getExplicitPromptAssetIds(
  files: UploadedFile[],
  selectedAssetIds: readonly string[] = [],
): string[] {
  return uniqueIds([
    ...selectedAssetIds,
    ...files.filter(isFreshPromptUpload).map((file) => file.fileID),
  ]);
}

export function buildAttachmentFromFiles(files: UploadedFile[]): Message['attachment'] | undefined {
  if (files.length === 0) return undefined;
  const firstFile = files[0];
  return {
    kind: 'csv',
    name: files.length === 1 ? firstFile.filename : `${files.length} files`,
    sourceType: files.length === 1 ? firstFile.sourceType : 'Multiple',
    accountName: files.length === 1 ? firstFile.accountName : undefined,
    propertyName: files.length === 1 ? firstFile.propertyName : undefined,
    syncVersionName: files.length === 1 ? firstFile.syncVersionName : undefined,
    files: files.map((file) => ({
      id: file.fileID,
      name: file.filename,
      ext: file.ext,
      sourceType: file.sourceType,
      accountName: file.accountName,
      propertyName: file.propertyName,
      syncVersionName: file.syncVersionName,
    })),
  };
}

interface ChatState {
  // Input state
  inputValue: string;
  isTyping: boolean;

  // Messages state
  messages: Message[];

  // File state
  uploadedFiles: UploadedFile[];
  /** Files queued from the Files tab to be restored after WorkspaceNewChat's resetChat() */
  pendingFilesForNewChat: UploadedFile[];
  currentConversationId: string | null;
  currentProjectId: string | null;

  // Processing state
  isProcessing: boolean;
  currentWorkflowStep: string | null;
  priorWorkflowSteps: string[];
  thinkingEvents: ThinkingEvent[];
  /** True while an SSE workflow stream is the live source of step/thinking updates. */
  isStreamingWorkflow: boolean;
  /**
   * Where the workflow update channel actually is, as opposed to whether SSE
   * happens to be connected right now. 'connecting' is the window between
   * starting a run and the stream proving itself; the thinking-events poller
   * must stay quiet during it, and only take over on 'fallback'.
   */
  workflowStreamState: 'idle' | 'connecting' | 'live' | 'fallback';

  // UI state
  dropdownOpen: boolean;
  selectedDataSource: string;

  // Speech recognition state
  isListening: boolean;
  transcript: string;
  detectedLanguage: string | null;

  // Theme state
  dashboardTheme: 'light' | 'dark';
  isThemeChanging: boolean;
  hasShownInitialDashboard: boolean;
  isInitialLoading: boolean;

  // Layout state
  isDashboardOpen: boolean;

  // Dashboard update feedback state
  isUpdatingDashboard: boolean;
  // True while `selectDashboard` is awaiting the GET /dashboard fetch.
  // Drives the in-place loading pill, dim/freeze, and sidebar-disable in
  // project.tsx so the user gets immediate feedback instead of a 1–3 s
  // silent gap that ends in a layout snap.
  isSwitchingDashboard: boolean;
  previousDashboardData: unknown | null;
  changedComponentIds: Set<string>;
  // Per-component "applying edit" state. Holds the canonical component keys
  // (see getComponentKey) of charts the user is actively editing via chat, so
  // the target card can show an in-place "Applying your change…" overlay while
  // Morpheus works. Cleared the moment new dashboard data lands so the existing
  // `dashboard-component-highlight` pulse takes over seamlessly.
  applyingComponentIds: Set<string>;
  // In-flight chart/table edit context, persisted so it survives an ask-first
  // clarification round-trip (the clarification answer is a separate store
  // action). Null when no edit is in flight.
  pendingEdit: { dashboardId: string | null; componentKeys: string[] } | null;
  dashboardThumbnails: Record<string, string>;
  // Phase 6 edit metadata. Both are populated only after a chart edit (the
  // backend returns them on the dashboard response) and stay null for normal
  // full-dashboard generation. Chat keeps lightweight what-changed completion
  // details; Activity owns reasoning/code/output.
  editChangeSummary: ChartChangeSummary | null;
  editProvenance: EditDataProvenance | null;
  // Activity transparency ("How this was calculated"). `analysisSteps` is the
  // persisted, final list from the dashboard response (null until a run records
  // steps); the Activity tab falls back to live `thinkingEvents` while a run
  // is still processing. `isActivityOpen` is retained for compatibility with
  // legacy/mobile callers; the desktop Activity display is embedded in chat.
  analysisSteps: AnalysisStep[] | null;
  isActivityOpen: boolean;

  // Dashboard selection state
  selectedDashboardId: string | null;

  // Original file for exports
  originalFileBlob?: Blob | null;
  originalFileName?: string | null;

  // Theme/focus state. selectedTemplate/isTemplatePending are compatibility aliases
  // for existing UI surfaces that still render a single chip.
  selectedTheme: SelectedTemplate | null;
  selectedAnalysisFocusId: string | null;
  selectedTemplate: SelectedTemplate | null;
  /** True only when the user explicitly chose a theme before submitting. False when restored from a saved dashboard. */
  isThemePending: boolean;
  isTemplatePending: boolean;

  // Abort controller for stopping generation
  abortController: AbortController | null;

  // Integration states
  isGoogleSheetsModalOpen: boolean;
  isGA4ModalOpen: boolean;
  isMetaAdsModalOpen: boolean;
  isTikTokModalOpen: boolean;
  isAppsFlyerModalOpen: boolean;
  isStripeModalOpen: boolean;
  isHubSpotModalOpen: boolean;
  isSalesforceModalOpen: boolean;
  isPipedriveModalOpen: boolean;
  isShopifyModalOpen: boolean;
  isKlaviyoModalOpen: boolean;
  isQuickBooksModalOpen: boolean;
  isZendeskModalOpen: boolean;
  isMixpanelModalOpen: boolean;
  isPostHogModalOpen: boolean;
  isCustomerIOModalOpen: boolean;
  isGoogleSearchConsoleModalOpen: boolean;
  isAmazonSellerModalOpen: boolean;
  isTikTokShopSellerModalOpen: boolean;
  isShopeeSellerModalOpen: boolean;
  isLazadaSellerModalOpen: boolean;
  isSupabaseModalOpen: boolean;
  isGoogleAdsModalOpen: boolean;
  isFirebaseModalOpen: boolean;
  isWarehouseModalOpen: boolean;
  warehouseModalConnectorKey: WarehouseConnectorKey;
  isAllConnectorsModalOpen: boolean;
  isTemplateModalOpen: boolean;
  templateModalSource: 'toolbar' | 'header';
  googleSheetsFileId: string | null;
  googleSheetsFileName: string | null;

  // Pending action state for cross-page navigation
  pendingAction: PendingAction | null;

  // Selected model state
  selectedModel: 'pro' | 'fast';

  // Actions
  setInputValue: (value: string) => void;
  setIsTyping: (typing: boolean) => void;
  setMessages: (messages: Message[]) => void;
  addMessage: (message: Message) => void;
  addFiles: (files: UploadedFile[]) => void;
  removeFile: (fileId: string) => void;
  clearFiles: () => void;
  updateFile: (fileId: string, updates: Partial<UploadedFile>) => void;
  setPendingFilesForNewChat: (files: UploadedFile[]) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDropdownOpen: (open: boolean) => void;
  setSelectedDataSource: (source: string) => void;
  setIsListening: (listening: boolean) => void;
  setTranscript: (transcript: string) => void;
  setDetectedLanguage: (language: string | null) => void;
  setIsProcessing: (processing: boolean) => void;
  setCurrentWorkflowStep: (step: string | null) => void;
  setPriorWorkflowSteps: (steps: string[]) => void;
  setThinkingEvents: (events: ThinkingEvent[]) => void;
  clearThinkingEvents: () => void;
  updateMessages: (updater: (prev: Message[]) => Message[]) => void;
  upsertEditCompletionMessage: (payload: EditCompletionPayload) => void;
  setDashboardTheme: (theme: 'light' | 'dark') => void;
  setIsThemeChanging: (changing: boolean) => void;
  setHasShownInitialDashboard: (flag: boolean) => void;
  setIsInitialLoading: (flag: boolean) => void;
  setIsDashboardOpen: (open: boolean) => void;
  setIsUpdatingDashboard: (updating: boolean) => void;
  setIsSwitchingDashboard: (switching: boolean) => void;
  setPreviousDashboardData: (data: unknown | null) => void;
  setChangedComponentIds: (ids: Set<string>) => void;
  setEditChangeSummary: (summary: ChartChangeSummary | null) => void;
  setEditProvenance: (provenance: EditDataProvenance | null) => void;
  setAnalysisSteps: (steps: AnalysisStep[] | null) => void;
  setActivityOpen: (open: boolean) => void;
  setApplyingComponentIds: (ids: string[]) => void;
  clearApplyingComponentIds: () => void;
  setPendingEdit: (edit: { dashboardId: string | null; componentKeys: string[] } | null) => void;
  setDashboardThumbnail: (dashboardId: string, thumbnailUrl: string) => void;
  setSelectedDashboardId: (dashboardId: string | null) => void;
  setOriginalFile: (file: { blob: Blob; name: string } | null) => void;
  setSelectedTheme: (theme: SelectedTemplate | null, pending?: boolean) => void;
  setSelectedTemplate: (template: SelectedTemplate | null, pending?: boolean) => void;
  setCurrentProjectId: (id: string | null) => void;
  setPendingAction: (action: PendingAction | null) => void;
  setSelectedModel: (model: 'pro' | 'fast') => void;

  // Integration setters
  setGoogleSheetsModalOpen: (open: boolean) => void;
  setGA4ModalOpen: (open: boolean) => void;
  setMetaAdsModalOpen: (open: boolean) => void;
  setTikTokModalOpen: (open: boolean) => void;
  setAppsFlyerModalOpen: (open: boolean) => void;
  setStripeModalOpen: (open: boolean) => void;
  setHubSpotModalOpen: (open: boolean) => void;
  setSalesforceModalOpen: (open: boolean) => void;
  setPipedriveModalOpen: (open: boolean) => void;
  setShopifyModalOpen: (open: boolean) => void;
  setKlaviyoModalOpen: (open: boolean) => void;
  setQuickBooksModalOpen: (open: boolean) => void;
  setZendeskModalOpen: (open: boolean) => void;
  setMixpanelModalOpen: (open: boolean) => void;
  setPostHogModalOpen: (open: boolean) => void;
  setCustomerIOModalOpen: (open: boolean) => void;
  setGoogleSearchConsoleModalOpen: (open: boolean) => void;
  setAmazonSellerModalOpen: (open: boolean) => void;
  setTikTokShopSellerModalOpen: (open: boolean) => void;
  setShopeeSellerModalOpen: (open: boolean) => void;
  setLazadaSellerModalOpen: (open: boolean) => void;
  setSupabaseModalOpen: (open: boolean) => void;
  setGoogleAdsModalOpen: (open: boolean) => void;
  setFirebaseModalOpen: (open: boolean) => void;
  setWarehouseModalOpen: (open: boolean, connectorKey?: WarehouseConnectorKey) => void;
  setAllConnectorsModalOpen: (open: boolean) => void;
  setTemplateModalOpen: (open: boolean, source?: 'toolbar' | 'header') => void;
  setGoogleSheetsFileId: (id: string | null) => void;
  setGoogleSheetsFileName: (name: string | null) => void;

  // Complex actions
  sendMessage: (content: string) => void;
  clearInput: () => void;
  resetChat: (preserveTemplate?: boolean) => void;
  processFileWithMessage: (content: string, onProcessedDataChange?: (data: unknown) => void, projectId?: string, mentionedAssetIds?: string[], activeFileAttachment?: Message['attachment'], mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: unknown }>, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => Promise<void>;
  submitClarificationResponse: (answers: ClarificationAnswer[], projectId: string, onProcessedDataChange?: (data: unknown) => void, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => Promise<void>;
  stopGeneration: () => Promise<void>;
  resumeWorkflowPolling: (projectId: string, conversationId: string, onProcessedDataChange?: (data: unknown) => void) => Promise<void>;
  selectDashboard: (dashboardId: string, projectId: string) => Promise<unknown>;

  // Sync actions
  syncGoogleSheets: (projectId?: string, oauthToken?: string) => Promise<void>;
  syncGA4: (propertyId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string, propertyName?: string) => Promise<void>;
  syncMetaAds: (adAccountId: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, accountName?: string, adsetIds?: string[], campaignIds?: string[]) => Promise<MetaAdsSyncResult>;
  syncTikTokAds: (adAccountId: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, accountName?: string) => Promise<TikTokAdsSyncResult>;
  syncAppsFlyer: (appId: string, appName: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<AppsFlyerSyncResult>;
  syncStripe: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
  syncHubSpot: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, pipelineId?: string, ownerId?: string, rowLimit?: number, includeAssociations?: boolean) => Promise<HubSpotSyncResult>;
  syncSalesforce: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, objectName?: string, ownerId?: string, rowLimit?: number) => Promise<SalesforceSyncResult>;
  syncPipedrive: (reportType: string, projectId?: string, datePreset?: string, startDate?: string, endDate?: string, pipelineId?: string, ownerId?: string, rowLimit?: number) => Promise<PipedriveSyncResult>;
  syncShopify: (request: ShopifySyncRequest) => Promise<ShopifySyncResult>;
  syncKlaviyo: (request: KlaviyoSyncRequest) => Promise<KlaviyoSyncResult>;
  syncQuickBooks: (request: QuickBooksSyncRequest) => Promise<QuickBooksSyncResult>;
  syncZendesk: (request: ZendeskSyncRequest) => Promise<ZendeskSyncResult>;
  syncMixpanel: (request: MixpanelSyncRequest) => Promise<MixpanelSyncResult>;
  syncPostHog: (request: PostHogSyncRequest) => Promise<PostHogSyncResult>;
  syncCustomerIO: (request: CustomerIOSyncRequest) => Promise<CustomerIOSyncResult>;
  syncGoogleSearchConsole: (request: GoogleSearchConsoleSyncRequest) => Promise<GoogleSearchConsoleSyncResult>;
  syncAmazonSeller: (request: AmazonSellerSyncRequest) => Promise<AmazonSellerSyncResult>;
  syncTikTokShopSeller: (request: TikTokShopSellerSyncRequest) => Promise<TikTokShopSellerSyncResult>;
  syncShopeeSeller: (request: ShopeeSellerSyncRequest) => Promise<ShopeeSellerSyncResult>;
  syncLazadaSeller: (request: LazadaSellerSyncRequest) => Promise<LazadaSellerSyncResult>;
  syncSupabase: (request: SupabaseSyncRequest) => Promise<SupabaseSyncResult>;
  syncGoogleAds: (adAccountId: string, projectId?: string, startDate?: string, endDate?: string, accountName?: string) => Promise<StripeSyncResult>;
  syncFirebase: (firebaseProjectId: string, projectName: string, projectId?: string, startDate?: string, endDate?: string) => Promise<StripeSyncResult>;
}

/** Result of AppsFlyer sync API */
export interface AppsFlyerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

/** Result of Stripe sync API */
export interface StripeSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
}

/** Result of HubSpot sync API */
export interface HubSpotSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Salesforce sync API */
export interface SalesforceSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
}

/** Result of Pipedrive sync API */
export interface PipedriveSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
}

/** Result of Shopify sync API */
export interface ShopifySyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Klaviyo sync API */
export interface KlaviyoSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of QuickBooks sync API */
export interface QuickBooksSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Zendesk sync API */
export interface ZendeskSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
}

/** Result of Mixpanel sync API */
export interface MixpanelSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of PostHog sync API */
export interface PostHogSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Customer.io sync API */
export interface CustomerIOSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Google Search Console sync API */
export interface GoogleSearchConsoleSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Amazon Seller sync API */
export interface AmazonSellerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of TikTok Shop Seller sync API */
export interface TikTokShopSellerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Shopee Seller sync API */
export interface ShopeeSellerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Lazada Seller sync API */
export interface LazadaSellerSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
  api_mode?: string;
}

/** Result of Supabase sync API */
export interface SupabaseSyncResult {
  success: true;
  row_count: number;
  column_count: number;
  asset: import('@/services/fileService').AssetRecord;
  message?: string;
  entity_id?: string;
  truncated?: boolean;
}

export interface PendingAction {
  type: 'process_file';
  content: string;
  files: UploadedFile[];
  projectId: string;
  model?: 'pro' | 'fast';
  templateSelection?: ThemeSelection | null;
}

// Ordered sequence of workflow steps (used to reconstruct prior steps on resume)
const STEP_ORDER = ['initializing', 'initialized', 'load_conversation', 'download_asset', 'run_workflow', 'explore_files', 'ask_first', 'routing', 'reasoning', 'reasoning_internal', 'analyzing', 'execution', 'recomputing', 'synthesis', 'rendering', 'validation', 'finish'];

const getPriorWorkflowSteps = (step: string): string[] => {
  const stepIdx = STEP_ORDER.indexOf(step);
  return stepIdx > 0 ? STEP_ORDER.slice(0, stepIdx) : [];
};

/**
 * Drives live workflow updates, preferring the SSE stream and falling back to polling.
 *
 * Mirrors processingService.pollProcessingStatus's signature so call sites are unchanged.
 * If the stream connects, it becomes the sole source of step + thinking-event updates
 * (ChatInterface's thinking-events poller stands down via `isStreamingWorkflow`). If the
 * stream cannot connect, its service switches to polling and lets the separate thinking-
 * event poller resume so updates are never lost.
 */
const STREAM_CONNECT_DEADLINE_MS = 4000;

const runWorkflowUpdates = async (
  assetId: string,
  projectId: string,
  conversationId: string | undefined,
  onStatusUpdate: (status: ProcessingResponse) => void,
  maxAttempts: number,
  intervalMs: number,
  abortSignal: AbortSignal,
): Promise<ProcessingResponse> => {
  if (conversationId) {
    let streamResult;
    // If the stream has not proved itself within this window, treat it as failed
    // and let the poller take over. Generous on purpose: a slow connect is far
    // more common than a broken one, and falling back early costs requests.
    let connectDeadline: ReturnType<typeof setTimeout> | null = null;

    useChatStore.setState({ workflowStreamState: 'connecting' });
    connectDeadline = setTimeout(() => {
      if (useChatStore.getState().workflowStreamState !== 'connecting') return;
      console.warn(
        'Workflow stream did not connect within 4s; falling back to polling for thinking events.',
      );
      useChatStore.setState({ workflowStreamState: 'fallback' });
    }, STREAM_CONNECT_DEADLINE_MS);

    try {
      streamResult = await streamWorkflow({
        conversationId,
        projectId,
        assetId,
        abortSignal,
        onStatusUpdate,
        onConnected: () => useChatStore.setState({
          isStreamingWorkflow: true,
          workflowStreamState: 'live',
        }),
        onFallbackToPolling: () => useChatStore.setState({
          isStreamingWorkflow: false,
          workflowStreamState: 'fallback',
        }),
        pollingMaxAttempts: maxAttempts,
        pollingIntervalMs: intervalMs,
        onThinkingEvents: (events) => {
          if (abortSignal.aborted) return;
          useChatStore.getState().setThinkingEvents(events);
        },
      });
    } finally {
      // Always clear the deadline. streamWorkflow can resolve without ever
      // invoking a callback — that is exactly what the store tests mock — and a
      // timer surviving that would fire against a finished run.
      if (connectDeadline) clearTimeout(connectDeadline);
      useChatStore.setState({ isStreamingWorkflow: false, workflowStreamState: 'idle' });
    }

    // The stream service may resolve via SSE or its polling fallback.
    if (streamResult?.result) {
      return streamResult.result;
    }
    // Defensive fallback for an aborted or otherwise unresolved stream result.
  }

  return processingService.pollProcessingStatus(
    assetId,
    projectId,
    conversationId,
    onStatusUpdate,
    maxAttempts,
    intervalMs,
    abortSignal,
  );
};

function getPendingPromptTheme(state: Pick<ChatState, 'selectedTheme' | 'selectedTemplate' | 'isThemePending' | 'isTemplatePending'>): SelectedTemplate | null {
  if (state.isThemePending && state.selectedTheme) return state.selectedTheme;
  if (state.isTemplatePending && state.selectedTemplate) return state.selectedTemplate;
  return null;
}

function getPromptThemeMetadata(selection: SelectedTemplate | null): Partial<NonNullable<ConversationChatRequest['user_node_metadata']>> {
  return selection ? { theme_source: EXPLICIT_PROMPT_THEME_SOURCE } : {};
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function compactRecord(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  );
}

function getClarificationAssetIds(option: ClarificationOption): string[] {
  const rawIds = option.metadata?.asset_ids;
  return Array.isArray(rawIds)
    ? rawIds.map((id) => String(id)).filter(Boolean)
    : [];
}

function getClarificationAssetRecords(option: ClarificationOption): Record<string, unknown>[] {
  const metadata = option.metadata ?? {};
  const asset = asRecord(metadata.asset);
  const assets = Array.isArray(metadata.assets)
    ? metadata.assets.map(asRecord).filter((item): item is Record<string, unknown> => Boolean(item))
    : [];
  return asset ? [asset, ...assets] : assets;
}

function findClarificationAssetRecord(
  option: ClarificationOption,
  assetId: string,
): Record<string, unknown> | null {
  return getClarificationAssetRecords(option).find((asset) => (
    readString(asset.asset_id) === assetId || readString(asset.file_id) === assetId
  )) ?? null;
}

function createClarificationAssetData(
  option: ClarificationOption,
  assetId: string,
  index: number,
): Record<string, unknown> {
  const asset = findClarificationAssetRecord(option, assetId);
  const extension = readString(asset?.extension) || readString(asset?.ext);
  const sourceType = readString(asset?.sourceType) || readString(asset?.asset_type);
  const filename = readString(asset?.filename) || readString(asset?.name) || option.label;

  return compactRecord({
    asset_id: assetId,
    file_id: readString(asset?.file_id),
    filename,
    extension,
    kind: readString(asset?.kind) || (extension === 'csv' ? 'csv' : 'file'),
    sourceType,
    asset_type: readString(asset?.asset_type) || sourceType,
    accountName: readString(asset?.accountName) || readString(asset?.account_name),
    propertyName: readString(asset?.propertyName) || readString(asset?.property_name) || (index === 0 ? option.label : undefined),
    syncVersionName: readString(asset?.syncVersionName) || readString(asset?.sync_version_name),
  });
}

function buildClarificationAttachment(option: ClarificationOption): Message['attachment'] | undefined {
  const selectedAssetIds = getClarificationAssetIds(option);
  if (selectedAssetIds.length === 0) return undefined;

  const files = selectedAssetIds.map((assetId, index) => {
    const data = createClarificationAssetData(option, assetId, index);
    return {
      id: assetId,
      name: readString(data.filename) || option.label,
      ext: readString(data.extension),
      sourceType: readString(data.sourceType) || readString(data.asset_type),
      accountName: readString(data.accountName),
      propertyName: readString(data.propertyName),
      syncVersionName: readString(data.syncVersionName),
    };
  });
  const firstFile = files[0];

  return {
    kind: firstFile?.ext === 'csv' ? 'csv' : 'file',
    name: files.length > 1 ? `${files.length} files` : firstFile.name,
    sourceType: files.length > 1 ? 'Multiple' : firstFile.sourceType,
    accountName: files.length > 1 ? undefined : firstFile.accountName,
    propertyName: files.length > 1 ? undefined : firstFile.propertyName,
    syncVersionName: files.length > 1 ? undefined : firstFile.syncVersionName,
    files,
  };
}

function createClarificationResponseContents(
  answers: ClarificationAnswer[],
): ConversationChatRequest['user_node_contents'] {
  const contents: ConversationChatRequest['user_node_contents'] = [];

  answers.forEach(({ request, option, freeText }) => {
    contents.push({
      type: 'clarification_response',
      data: {
        clarification_id: request.clarification_id,
        selected_option_id: option.id,
        selected_option_label: option.label,
        free_text: freeText ?? null,
        metadata: option.metadata ?? {},
      },
    });
  });

  // Append one asset content per uniquely selected data source across answers.
  const seenAssetIds = new Set<string>();
  answers.forEach(({ option }) => {
    getClarificationAssetIds(option).forEach((assetId) => {
      if (seenAssetIds.has(assetId)) return;
      seenAssetIds.add(assetId);
      contents.push({
        type: 'asset',
        data: createClarificationAssetData(option, assetId, seenAssetIds.size - 1),
      });
    });
  });

  return contents;
}

/** Union of selected asset ids across every answered clarification. */
function getAnswersAssetIds(answers: ClarificationAnswer[]): string[] {
  const ids: string[] = [];
  answers.forEach(({ option }) => {
    getClarificationAssetIds(option).forEach((assetId) => {
      if (!ids.includes(assetId)) ids.push(assetId);
    });
  });
  return ids;
}

/** explicit/all wins over none when answers disagree on data scope. */
function getAnswersSelectionMode(answers: ClarificationAnswer[], assetIds: string[]): AssetSelectionMode {
  for (const { option } of answers) {
    const mode = option.metadata?.asset_selection;
    if (mode === 'explicit' || mode === 'all') return mode;
  }
  return assetIds.length > 0 ? 'explicit' : 'none';
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "assistant",
    content: "Hi! I'm Dreamify, your analytics intern. Upload data, visualise motion-rich dashboard in seconds!",
    timestamp: new Date()
  }
];

function dashboardResponseFromProcessing(data?: ProcessingResponse['data']): DashboardDataResponse | null {
  if (!data) return null;
  const hasDashboardResponse =
    data.dashboard_id !== undefined ||
    data.dashboard_data !== undefined ||
    data.change_summary !== undefined ||
    data.computed_values !== undefined ||
    data.analysis_steps !== undefined ||
    data.edit_note !== undefined;
  if (!hasDashboardResponse) return null;

  return {
    dashboard_id: data.dashboard_id ?? null,
    dashboard_data: data.dashboard_data ?? null,
    change_summary: data.change_summary ?? null,
    computed_values: data.computed_values ?? null,
    analysis_steps: data.analysis_steps ?? null,
    edit_note: typeof data.edit_note === 'string' && data.edit_note.trim()
      ? data.edit_note.trim()
      : null,
  };
}

function mergeDashboardResponses(
  primary: DashboardDataResponse | null,
  fallback: DashboardDataResponse | null,
): DashboardDataResponse | null {
  if (!primary) return fallback;
  if (!fallback) return primary;

  return {
    dashboard_id: primary.dashboard_id ?? fallback.dashboard_id,
    dashboard_data: primary.dashboard_data ?? fallback.dashboard_data,
    change_summary: primary.change_summary ?? fallback.change_summary ?? null,
    computed_values: primary.computed_values ?? fallback.computed_values ?? null,
    analysis_steps: primary.analysis_steps ?? fallback.analysis_steps ?? null,
    edit_note: primary.edit_note ?? fallback.edit_note ?? null,
  };
}

/**
 * Re-fetch the edited dashboard by id (cache-busted) so the view shows the true
 * in-place server state, preserving edit metadata from both the live workflow
 * response and the dashboard endpoint.
 */
async function refetchEditedDashboardResponse(
  conversationId: string,
  projectId: string,
  editTargetDashboardId: string | null,
  fallbackResponse: DashboardDataResponse | null,
): Promise<DashboardDataResponse | null> {
  if (!editTargetDashboardId) return fallbackResponse;

  const { conversationService } = await import('@/services/conversationService');
  const targeted = await conversationService.getDashboardData(
    conversationId,
    projectId,
    editTargetDashboardId,
    { noCache: true },
  );
  return mergeDashboardResponses(targeted, fallbackResponse);
}

function latestUserMessageIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

function latestChartMentionNames(messages: Message[]): string[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user' || !message.chartMentions?.length) continue;
    return message.chartMentions.map((chart) => chart.title).filter(Boolean);
  }
  return [];
}

function buildEditCompletionContent(
  messages: Message[],
  payload: EditCompletionPayload,
  existingContent?: string,
): string {
  const editNote = payload.editNote?.trim();
  if (editNote) return editNote;

  const humanSummary = payload.summary?.human_summary?.trim();
  if (humanSummary) return humanSummary;

  const existing = existingContent?.trim();
  if (existing) return existing;

  const names = latestChartMentionNames(messages);
  const target = names.length
    ? names.join(', ')
    : payload.dashboardTitle || 'the selected chart or table';
  return `Done! I've updated ${target}. The dashboard has been refreshed with your changes.`;
}

function upsertEditCompletionMessageInList(
  messages: Message[],
  payload: EditCompletionPayload,
): Message[] {
  const userIndex = latestUserMessageIndex(messages);
  const dashboardId = payload.dashboardId ?? null;
  let targetIndex = -1;
  let dashboardCardFallbackIndex = -1;

  for (let i = messages.length - 1; i > userIndex; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    if (message.isEditCompletion || (dashboardId && message.dashboardCard?.dashboardId === dashboardId)) {
      targetIndex = i;
      break;
    }
    if (dashboardCardFallbackIndex < 0 && message.dashboardCard) {
      dashboardCardFallbackIndex = i;
    }
  }

  if (targetIndex < 0) {
    targetIndex = dashboardCardFallbackIndex;
  }

  if (targetIndex >= 0) {
    const next = messages.slice();
    const existing = next[targetIndex];
    const updated: Message = {
      ...existing,
      content: buildEditCompletionContent(messages, payload, existing.content),
      isEditCompletion: true,
      editChangeSummary: payload.summary ?? null,
      editProvenance: payload.provenance ?? null,
      editNote: payload.editNote ?? null,
    };
    delete updated.dashboardCard;
    next[targetIndex] = updated;
    return next;
  }

  return [
    ...messages,
    {
      id: `edit-completion-${dashboardId || Date.now()}`,
      role: 'assistant',
      content: buildEditCompletionContent(messages, payload),
      timestamp: new Date(),
      isEditCompletion: true,
      editChangeSummary: payload.summary ?? null,
      editProvenance: payload.provenance ?? null,
      editNote: payload.editNote ?? null,
    },
  ];
}

/**
 * Write processed dashboard data to the file the dashboard view actually reads
 * (matched by project + conversation), not just uploadedFiles[0] — otherwise
 * project.tsx's sync effect can overwrite fresh data with a stale file's.
 */
function writeProcessedDataToViewFile(
  files: Array<{ fileID: string; projectId?: string; conversationId?: string }>,
  projectId: string,
  conversationId: string,
  data: unknown,
  updateFile: (fileID: string, patch: Record<string, unknown>) => void,
): void {
  const target =
    files.find((f) => f.projectId === projectId && f.conversationId === conversationId) ||
    files.find((f) => f.projectId === projectId) ||
    files[0];
  if (target) {
    updateFile(target.fileID, { status: 'processed', processedData: data });
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  inputValue: "",
  isTyping: false,
  messages: initialMessages,
  uploadedFiles: [],
  pendingFilesForNewChat: [],
  currentConversationId: null,
  currentProjectId: null,
  isProcessing: false,
  currentWorkflowStep: null,
  priorWorkflowSteps: [],
  thinkingEvents: [],
  isStreamingWorkflow: false,
  workflowStreamState: 'idle',
  dropdownOpen: false,
  selectedDataSource: "",
  isListening: false,
  transcript: "",
  detectedLanguage: null,
  dashboardTheme: 'light',
  isThemeChanging: false,
  hasShownInitialDashboard: false,
  isInitialLoading: false,
  isDashboardOpen: false,
  isUpdatingDashboard: false,
  isSwitchingDashboard: false,
  previousDashboardData: null,
  changedComponentIds: new Set<string>(),
  editChangeSummary: null,
  editProvenance: null,
  analysisSteps: null,
  isActivityOpen: false,
  applyingComponentIds: new Set<string>(),
  pendingEdit: null,
  dashboardThumbnails: {},
  selectedDashboardId: null,
  originalFileBlob: null,
  originalFileName: null,
  selectedTheme: readPendingThemeSelection(),
  selectedAnalysisFocusId: readPendingThemeSelection()?.analysisFocusId ?? null,
  selectedTemplate: readPendingThemeSelection(),
  isThemePending: (() => { try { return !!localStorage.getItem(SELECTED_THEME_KEY) || !!localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY); } catch { return false; } })(),
  isTemplatePending: (() => { try { return !!localStorage.getItem(SELECTED_THEME_KEY) || !!localStorage.getItem(LEGACY_SELECTED_TEMPLATE_KEY); } catch { return false; } })(),
  abortController: null,
  pendingAction: null,
  isGoogleSheetsModalOpen: false,
  isGA4ModalOpen: false,
  isMetaAdsModalOpen: false,
  isTikTokModalOpen: false,
  isAppsFlyerModalOpen: false,
  isStripeModalOpen: false,
  isHubSpotModalOpen: false,
  isSalesforceModalOpen: false,
  isPipedriveModalOpen: false,
  isShopifyModalOpen: false,
  isKlaviyoModalOpen: false,
  isQuickBooksModalOpen: false,
  isZendeskModalOpen: false,
  isMixpanelModalOpen: false,
  isPostHogModalOpen: false,
  isCustomerIOModalOpen: false,
  isGoogleSearchConsoleModalOpen: false,
  isAmazonSellerModalOpen: false,
  isTikTokShopSellerModalOpen: false,
  isShopeeSellerModalOpen: false,
  isLazadaSellerModalOpen: false,
  isSupabaseModalOpen: false,
  isGoogleAdsModalOpen: false,
  isFirebaseModalOpen: false,
  isWarehouseModalOpen: false,
  warehouseModalConnectorKey: 'postgres',
  isAllConnectorsModalOpen: false,
  isTemplateModalOpen: false,
  templateModalSource: 'toolbar' as const,
  googleSheetsFileId: null,
  googleSheetsFileName: null,
  selectedModel: 'pro',

  // Basic setters
  setInputValue: (value) => set({ inputValue: value }),
  setIsTyping: (typing) => set({ isTyping: typing }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message]
  })),
  addFiles: (files) => set((state) => {
    const currentLength = state.uploadedFiles.length;
    const newLength = currentLength + files.length;
    if (newLength > 3) {
      console.warn('Maximum 3 files allowed in the Hobby demo');
      return state;
    }
    const existingIds = new Set(state.uploadedFiles.map(f => f.fileID));
    const uniqueFiles = files.filter(f => !existingIds.has(f.fileID));
    return {
      uploadedFiles: [...state.uploadedFiles, ...uniqueFiles]
    };
  }),
  removeFile: (fileId) => set((state) => ({
    uploadedFiles: state.uploadedFiles.filter(f => f.fileID !== fileId)
  })),
  clearFiles: () => set({ uploadedFiles: [] }),
  setPendingFilesForNewChat: (files) => set({ pendingFilesForNewChat: files }),
  updateFile: (fileId, updates) => set((state) => ({
    uploadedFiles: state.uploadedFiles.map(f => f.fileID === fileId ? { ...f, ...updates } : f)
  })),
  setCurrentConversationId: (conversationId) => set({ currentConversationId: conversationId }),
  setDropdownOpen: (open) => set({ dropdownOpen: open }),
  setSelectedDataSource: (source) => set({ selectedDataSource: source }),
  setIsListening: (listening) => set({ isListening: listening }),
  setTranscript: (transcript) => set({ transcript }),
  setDetectedLanguage: (language) => set({ detectedLanguage: language }),
  setIsProcessing: (processing) => set({ isProcessing: processing }),
  setCurrentWorkflowStep: (step) => set({ currentWorkflowStep: step }),
  setPriorWorkflowSteps: (steps) => set({ priorWorkflowSteps: steps }),
  setThinkingEvents: (events) => set({ thinkingEvents: events }),
  clearThinkingEvents: () => set({ thinkingEvents: [] }),
  updateMessages: (updater) => set((state) => ({ messages: updater(state.messages) })),
  upsertEditCompletionMessage: (payload) => set((state) => ({
    messages: upsertEditCompletionMessageInList(state.messages, payload),
  })),
  setDashboardTheme: (theme) => set({ dashboardTheme: theme }),
  setIsThemeChanging: (changing) => set({ isThemeChanging: changing }),
  setHasShownInitialDashboard: (flag) => set({ hasShownInitialDashboard: flag }),
  setIsInitialLoading: (flag) => set({ isInitialLoading: flag }),
  setIsDashboardOpen: (open) => set({ isDashboardOpen: open }),
  setIsUpdatingDashboard: (updating) => set({ isUpdatingDashboard: updating }),
  setIsSwitchingDashboard: (switching) => set({ isSwitchingDashboard: switching }),
  setPreviousDashboardData: (data) => set({ previousDashboardData: data }),
  setChangedComponentIds: (ids) => set({ changedComponentIds: ids }),
  setEditChangeSummary: (summary) => set({ editChangeSummary: summary }),
  setEditProvenance: (provenance) => set({ editProvenance: provenance }),
  setAnalysisSteps: (steps) => set({ analysisSteps: steps }),
  setActivityOpen: (open) => set({ isActivityOpen: open }),
  setApplyingComponentIds: (ids) => set({ applyingComponentIds: new Set(ids) }),
  clearApplyingComponentIds: () => set({ applyingComponentIds: new Set<string>() }),
  setPendingEdit: (edit) => set({ pendingEdit: edit }),
  setDashboardThumbnail: (dashboardId, thumbnailUrl) => set((state) => ({
    dashboardThumbnails: { ...state.dashboardThumbnails, [dashboardId]: thumbnailUrl }
  })),
  setSelectedDashboardId: (dashboardId) => {
    const restoredTheme = dashboardId
      ? resolveStoredTheme(getThemeIdForDashboard(dashboardId), null, getLegacyTemplateIdForDashboard(dashboardId))
      : null;
    set({
      selectedDashboardId: dashboardId,
      selectedTheme: restoredTheme,
      selectedAnalysisFocusId: restoredTheme?.analysisFocusId ?? null,
      selectedTemplate: restoredTheme,
      isThemePending: false,
      isTemplatePending: false,
    });
  },
  setOriginalFile: (file) => set({ originalFileBlob: file?.blob ?? null, originalFileName: file?.name ?? null }),
  setSelectedTheme: (template, pending = true) => {
    const themeId = getThemeId(template);
    try {
      if (template) {
        persistPendingThemeSelection(pending ? template : null);
        const { selectedDashboardId, currentConversationId, currentProjectId } = get();
        if (selectedDashboardId && themeId) {
          saveDashboardThemeId(selectedDashboardId, themeId);
          // Persist to backend only when changing theme on an existing dashboard
          // (pending=false = post-run change from dashboard header).
          // Skip when pending=true: that means a pre-run toolbar pick for the NEXT
          // generation — it must NOT overwrite the current dashboard in S3.
          if (!pending && currentConversationId && currentProjectId) {
            import('@/services/conversationService').then(({ conversationService }) => {
              conversationService.updateDashboardTheme(
                currentConversationId,
                selectedDashboardId,
                currentProjectId,
                themeId,
              );
            });
          }
        }
      } else {
        persistPendingThemeSelection(null);
      }
    } catch { /* ignore */ }
    set({
      selectedTheme: template,
      selectedAnalysisFocusId: template?.analysisFocusId ?? null,
      selectedTemplate: template,
      isThemePending: pending && !!template,
      isTemplatePending: pending && !!template,
    });
  },
  setSelectedTemplate: (template, pending = true) => get().setSelectedTheme(template, pending),
  setPendingAction: (action) => set({ pendingAction: action }),
  setSelectedModel: (model) => set({ selectedModel: model }),
  setGoogleSheetsModalOpen: (open) => set({ isGoogleSheetsModalOpen: open }),
  setGA4ModalOpen: (open) => set({ isGA4ModalOpen: open }),
  setMetaAdsModalOpen: (open) => set({ isMetaAdsModalOpen: open }),
  setTikTokModalOpen: (open) => set({ isTikTokModalOpen: open }),
  setAppsFlyerModalOpen: (open) => set({ isAppsFlyerModalOpen: open }),
  setStripeModalOpen: (open) => set({ isStripeModalOpen: open }),
  setHubSpotModalOpen: (open) => set({ isHubSpotModalOpen: open }),
  setSalesforceModalOpen: (open) => set({ isSalesforceModalOpen: open }),
  setPipedriveModalOpen: (open) => set({ isPipedriveModalOpen: open }),
  setShopifyModalOpen: (open) => set({ isShopifyModalOpen: open }),
  setKlaviyoModalOpen: (open) => set({ isKlaviyoModalOpen: open }),
  setQuickBooksModalOpen: (open) => set({ isQuickBooksModalOpen: open }),
  setZendeskModalOpen: (open) => set({ isZendeskModalOpen: open }),
  setMixpanelModalOpen: (open) => set({ isMixpanelModalOpen: open }),
  setPostHogModalOpen: (open) => set({ isPostHogModalOpen: open }),
  setCustomerIOModalOpen: (open) => set({ isCustomerIOModalOpen: open }),
  setGoogleSearchConsoleModalOpen: (open) => set({ isGoogleSearchConsoleModalOpen: open }),
  setAmazonSellerModalOpen: (open) => set({ isAmazonSellerModalOpen: open }),
  setTikTokShopSellerModalOpen: (open) => set({ isTikTokShopSellerModalOpen: open }),
  setShopeeSellerModalOpen: (open) => set({ isShopeeSellerModalOpen: open }),
  setLazadaSellerModalOpen: (open) => set({ isLazadaSellerModalOpen: open }),
  setSupabaseModalOpen: (open) => set({ isSupabaseModalOpen: open }),
  setGoogleAdsModalOpen: (open) => set({ isGoogleAdsModalOpen: open }),
  setFirebaseModalOpen: (open) => set({ isFirebaseModalOpen: open }),
  setWarehouseModalOpen: (open, connectorKey) => set((state) => ({
    isWarehouseModalOpen: open,
    warehouseModalConnectorKey: connectorKey ?? state.warehouseModalConnectorKey,
  })),
  setAllConnectorsModalOpen: (open) => set({ isAllConnectorsModalOpen: open }),
  setTemplateModalOpen: (open, source = 'toolbar') => set({ isTemplateModalOpen: open, templateModalSource: source }),
  setGoogleSheetsFileId: (id) => {
    console.log('Store: setting googleSheetsFileId:', id);
    set({ googleSheetsFileId: id });
  },
  setGoogleSheetsFileName: (name) => {
    console.log('Store: setting googleSheetsFileName:', name);
    set({ googleSheetsFileName: name });
  },
  setCurrentProjectId: (id) => set({ currentProjectId: id }),

  // Sync actions implementation
  syncGoogleSheets: async (projectId, oauthToken) => {
    const { googleSheetsFileId, googleSheetsFileName, addFiles, setGoogleSheetsFileId, setGoogleSheetsFileName, setGoogleSheetsModalOpen } = get();
    if (!googleSheetsFileId) return;

    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleSheetData(googleSheetsFileId, projectId, oauthToken);

      if (response.success && response.asset) {
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'Google Sheets',
          accountName: 'Google Sheets',
          propertyName: googleSheetsFileName || response.asset.filename,
          rowCount: response.asset.row_count,
          columnCount: response.asset.column_count,
        };

        addFiles([newFile]);
        setGoogleSheetsFileId(null);
        setGoogleSheetsFileName(null);
        setGoogleSheetsModalOpen(false);
        emitConnectorSynced('Google Sheets');
      } else {
        throw new Error(response.error || 'Failed to sync Google Sheets');
      }
    } catch (err) {
      console.error('Sync Google Sheets error:', err);
      throw err;
    }
  },

  syncGA4: async (propertyId, projectId, startDate, endDate, accountName, propertyName) => {
    const { addFiles, setGA4ModalOpen } = get();
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAnalyticsData(
        propertyId,
        projectId,
        startDate || '30daysAgo',
        endDate || 'today',
        accountName || 'GA4',
        propertyName || 'GA4',
      );

      if (response.success && response.asset) {
        const assetMetadata = response.asset as AssetRecord & {
          accountName?: string;
          propertyName?: string;
        };
        const newFile = {
          fileID: response.asset.asset_id,
          filename: response.asset.filename,
          size: response.asset.size_bytes || 0,
          ext: response.asset.extension || 'csv',
          status: 'uploaded' as const,
          projectId: response.asset.project_id || undefined,
          sourceType: 'GA4',
          accountName: accountName || assetMetadata.accountName || 'GA4',
          propertyName: propertyName || assetMetadata.propertyName || response.asset.filename,
        };
        addFiles([newFile]);
        setGA4ModalOpen(false);
        emitConnectorSynced('GA4');
      } else {
        throw new Error(response.error || 'Failed to sync GA4');
      }
    } catch (err) {
      console.error('Sync GA4 error:', err);
      throw err;
    }
  },

  syncMetaAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName, adsetIds, campaignIds) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncMetaAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'Meta Ads',
        adsetIds,
        campaignIds
      );

      if (response.success && response.asset) {
        emitConnectorSynced('Meta Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Meta Ads');
    } catch (err) {
      console.error('Sync Meta Ads error:', err);
      throw err;
    }
  },

  syncTikTokAds: async (adAccountId, projectId, datePreset, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncTikTokAdsData(
        adAccountId,
        projectId,
        datePreset || 'last_30d',
        startDate,
        endDate,
        accountName || 'TikTok Ads',
      );

      if (response.success && response.asset) {
        emitConnectorSynced('TikTok Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync TikTok Ads');
    } catch (err) {
      console.error('Sync TikTok Ads error:', err);
      throw err;
    }
  },

  syncAppsFlyer: async (appId, appName, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncAppsFlyer({
        app_id: appId,
        app_name: appName,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('AppsFlyer');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync AppsFlyer');
    } catch (err) {
      console.error('Sync AppsFlyer error:', err);
      throw err;
    }
  },

  syncStripe: async (reportType, projectId, datePreset, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncStripe({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Stripe');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Stripe');
    } catch (err) {
      console.error('Sync Stripe error:', err);
      throw err;
    }
  },

  syncHubSpot: async (reportType, projectId, datePreset, startDate, endDate, pipelineId, ownerId, rowLimit, includeAssociations) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncHubSpot({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        pipeline_id: pipelineId || 'all',
        owner_id: ownerId || 'all',
        row_limit: rowLimit || 5000,
        include_associations: includeAssociations ?? true,
      });

      if (response.success && response.asset) {
        emitConnectorSynced('HubSpot');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync HubSpot');
    } catch (err) {
      console.error('Sync HubSpot error:', err);
      throw err;
    }
  },

  syncSalesforce: async (reportType, projectId, datePreset, startDate, endDate, objectName, ownerId, rowLimit) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncSalesforce({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        object_name: objectName || 'all',
        owner_id: ownerId || 'all',
        row_limit: rowLimit || 5000,
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Salesforce');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
        };
      }
      throw new Error(response.error || 'Failed to sync Salesforce');
    } catch (err) {
      console.error('Sync Salesforce error:', err);
      throw err;
    }
  },

  syncPipedrive: async (reportType, projectId, datePreset, startDate, endDate, pipelineId, ownerId, rowLimit) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncPipedrive({
        report_type: reportType,
        ...(projectId && { project_id: projectId }),
        date_preset: datePreset || 'last_30d',
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        pipeline_id: pipelineId || 'all',
        owner_id: ownerId || 'all',
        row_limit: rowLimit || 5000,
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Pipedrive');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
        };
      }
      throw new Error(response.error || 'Failed to sync Pipedrive');
    } catch (err) {
      console.error('Sync Pipedrive error:', err);
      throw err;
    }
  },

  syncShopify: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncShopify(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Shopify');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Shopify data');
    } catch (err) {
      console.error('Sync Shopify error:', err);
      throw err;
    }
  },

  syncKlaviyo: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncKlaviyo(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Klaviyo');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Klaviyo data');
    } catch (err) {
      console.error('Sync Klaviyo error:', err);
      throw err;
    }
  },

  syncQuickBooks: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncQuickBooks(request);

      if (response.success && response.asset) {
        emitConnectorSynced('QuickBooks');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync QuickBooks data');
    } catch (err) {
      console.error('Sync QuickBooks error:', err);
      throw err;
    }
  },

  syncZendesk: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncZendesk(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Zendesk');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
        };
      }
      throw new Error(response.error || 'Failed to sync Zendesk data');
    } catch (err) {
      console.error('Sync Zendesk error:', err);
      throw err;
    }
  },

  syncMixpanel: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncMixpanel(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Mixpanel');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Mixpanel data');
    } catch (err) {
      console.error('Sync Mixpanel error:', err);
      throw err;
    }
  },

  syncPostHog: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncPostHog(request);

      if (response.success && response.asset) {
        emitConnectorSynced('PostHog');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync PostHog data');
    } catch (err) {
      console.error('Sync PostHog error:', err);
      throw err;
    }
  },

  syncCustomerIO: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncCustomerIO(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Customer.io');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Customer.io data');
    } catch (err) {
      console.error('Sync Customer.io error:', err);
      throw err;
    }
  },

  syncGoogleSearchConsole: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleSearchConsole(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Google Search Console');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Google Search Console data');
    } catch (err) {
      console.error('Sync Google Search Console error:', err);
      throw err;
    }
  },

  syncAmazonSeller: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncAmazonSeller(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Amazon Seller');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Amazon Seller data');
    } catch (err) {
      console.error('Sync Amazon Seller error:', err);
      throw err;
    }
  },

  syncTikTokShopSeller: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncTikTokShopSeller(request);

      if (response.success && response.asset) {
        emitConnectorSynced('TikTok Shop Seller');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync TikTok Shop data');
    } catch (err) {
      console.error('Sync TikTok Shop Seller error:', err);
      throw err;
    }
  },

  syncShopeeSeller: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncShopeeSeller(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Shopee Seller');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Shopee Seller data');
    } catch (err) {
      console.error('Sync Shopee Seller error:', err);
      throw err;
    }
  },

  syncLazadaSeller: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncLazadaSeller(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Lazada Seller');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
          api_mode: response.api_mode,
        };
      }
      throw new Error(response.error || 'Failed to sync Lazada Seller data');
    } catch (err) {
      console.error('Sync Lazada Seller error:', err);
      throw err;
    }
  },

  syncSupabase: async (request) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncSupabase(request);

      if (response.success && response.asset) {
        emitConnectorSynced('Supabase');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
          entity_id: response.entity_id,
          truncated: response.truncated,
        };
      }
      throw new Error(response.error || 'Failed to sync Supabase data');
    } catch (err) {
      console.error('Sync Supabase error:', err);
      throw err;
    }
  },

  syncGoogleAds: async (adAccountId, projectId, startDate, endDate, accountName) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncGoogleAdsData({
        ad_account_id: adAccountId,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
        ...(accountName && { account_name: accountName }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Google Ads');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Google Ads');
    } catch (err) {
      console.error('Sync Google Ads error:', err);
      throw err;
    }
  },

  syncFirebase: async (firebaseProjectId, projectName, projectId, startDate, endDate) => {
    try {
      const { integrationService } = await import('@/services/integrationService');
      const response = await integrationService.syncFirebaseData({
        firebase_project_id: firebaseProjectId,
        app_name: projectName,
        ...(projectId && { project_id: projectId }),
        ...(startDate && { start_date: startDate }),
        ...(endDate && { end_date: endDate }),
      });

      if (response.success && response.asset) {
        emitConnectorSynced('Firebase');
        return {
          success: true as const,
          row_count: response.row_count ?? 0,
          column_count: response.column_count ?? 0,
          asset: response.asset,
          message: response.message,
        };
      }
      throw new Error(response.error || 'Failed to sync Firebase data');
    } catch (err) {
      console.error('Sync Firebase error:', err);
      throw err;
    }
  },

	  // Complex actions
	  sendMessage: (content) => {
	    const promptTheme = getPendingPromptTheme(get());
	    const promptFiles = getExplicitPromptFiles(get().uploadedFiles);
	    const userMessage: Message = {
	      id: Date.now().toString(),
	      role: "user",
	      content: content.trim(),
      timestamp: new Date(),
      attachment: buildAttachmentFromFiles(promptFiles),
	      template: promptTheme || undefined,
	    };

    set((state) => ({
      messages: [...state.messages, userMessage],
      inputValue: ""
    }));
  },

  clearInput: () => set({ inputValue: "" }),

		  processFileWithMessage: async (content: string, onProcessedDataChange?: (data: unknown) => void, projectIdParam?: string, mentionedAssetIds?: string[], activeFileAttachment?: Message['attachment'], mentionedCharts?: Array<{ id: string; componentId: string; title: string; type: string; config?: unknown }>, model?: 'pro' | 'fast', onAccepted?: () => void, onProjectNameAccepted?: (projectName: string) => void) => {
		    const state = get();
		    const { uploadedFiles, updateFile, setIsProcessing, setIsTyping, addMessage, updateMessages, messages, setDashboardTheme, setIsThemeChanging, hasShownInitialDashboard, dashboardTheme, currentConversationId, setCurrentConversationId, setCurrentWorkflowStep, setPriorWorkflowSteps } = state;
		    const promptTheme = getPendingPromptTheme(state);
		    const promptThemeId = getThemeId(promptTheme);
		    const promptAnalysisFocusId = getAnalysisFocusId(promptTheme);
		    const promptThemeMetadata = getPromptThemeMetadata(promptTheme);
	    const explicitAssetIds = getExplicitPromptAssetIds(uploadedFiles, mentionedAssetIds ?? []);
	    const explicitPromptFiles = getExplicitPromptFiles(uploadedFiles, explicitAssetIds);
	    const freshPromptUploads = uploadedFiles.filter(isFreshPromptUpload);
	    const workflowProjectId = projectIdParam || freshPromptUploads[0]?.projectId || null;
	    let workflowConversationId: string | null = currentConversationId;

	    // Create new AbortController for this processing session
	    const workflowRunId = beginWorkflowRun();
	    const abortController = new AbortController();
	    const isSameWorkflowContext = (conversationId?: string | null) => {
	      const current = get();
	      if (workflowProjectId && current.currentProjectId !== workflowProjectId) return false;
	      if (conversationId && current.currentConversationId !== conversationId) return false;
	      return true;
	    };
	    const isCurrentWorkflowRun = (conversationId?: string | null) => (
	      isWorkflowRunActive(workflowRunId) &&
	      !abortController.signal.aborted &&
	      isSameWorkflowContext(conversationId)
	    );
	    set({ abortController, currentProjectId: workflowProjectId, thinkingEvents: [], priorWorkflowSteps: [], isStreamingWorkflow: false, analysisSteps: null });

	    // Clear current workflow step at start
	    setCurrentWorkflowStep(null);
	    setPriorWorkflowSteps([]);

	    // Text-only message path: allow theme change after initial dashboard shown, only if currently light
    // @mentioned files should use Q&A path (they're already in conversation)
    const hasUploadedFiles = freshPromptUploads.length > 0;

    // Clear uploaded files immediately so they disappear from the input chips area
    // once the message start process is initiated.
    get().clearFiles();

    const isTextOnly = !hasUploadedFiles;

    if (isTextOnly) {
      // No file uploaded - process Q&A (with or without existing conversation)
      console.log('No file - processing Q&A', { hasConversation: !!currentConversationId, projectId: projectIdParam });

      // Check if we have projectId (required for API call)
      if (!projectIdParam) {
        console.log('No projectId - cannot process Q&A');
        const userMessage: Message = {
	          id: Date.now().toString(),
	          role: "user",
	          content: content.trim(),
	          timestamp: new Date(),
	          template: promptTheme || undefined,
	        };
        addMessage(userMessage);

        const errorMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: "Project context is required. Please ensure you are in a project workspace.",
          timestamp: new Date(),
	        };
	        addMessage(errorMessage);
	        set({ abortController: null });
	        finishWorkflowRun(workflowRunId);
	        return;
	      }

      // Process Q&A (with or without existing conversation)
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
        const userMessage: Message = {
          id: Date.now().toString(),
          role: "user",
          content: content.trim(),
          timestamp: new Date(),
          attachment: activeFileAttachment || buildAttachmentFromFiles(explicitPromptFiles),
	          chartMentions: mentionedCharts && mentionedCharts.length > 0
	            ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
	            : undefined,
	          template: promptTheme || undefined,
	        };
        addMessage(userMessage);
      }

      setIsTyping(true);
      setIsProcessing(true);

      // If dashboard is already open, mark as updating for edit feedback loop
      if (get().isDashboardOpen) {
        set({ isUpdatingDashboard: true });
      }

      // Update file status to processing to show loading indicator in chip
      // Skip files already 'processed' from previous conversation (restored on reload)
      explicitPromptFiles
        .filter(f => f.status !== 'processed')
        .forEach(f => updateFile(f.fileID, { status: 'processing' }));

      try {
        // Use projectId from parameter (required)
        const projectId = projectIdParam;

        if (!projectId) {
          throw new Error('Project context missing. Please ensure you are in a project workspace.');
        }

        // Only attach asset content if this is a NEW file upload, not an @mention of existing file
        const freshUploads = freshPromptUploads;

        let assetContents: ConversationChatRequest['user_node_contents'] | undefined;
        const assetId: string | null = freshUploads[0]?.fileID ?? null;

        // When this message carries chart mentions it is an in-place edit of the
        // dashboard the user is currently viewing — capture that id NOW so the
        // completion handler re-selects/re-fetches the edited dashboard instead of
        // jumping to the conversation's latest one. Null when not an edit.
        const editTargetDashboardId = mentionedCharts && mentionedCharts.length > 0
          ? get().selectedDashboardId ?? null
          : null;

        const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
        for (const file of freshUploads) {
          try {
            const { fileService } = await import('@/services/fileService');
            const assetResponse = await fileService.getAsset(file.fileID);
            if (assetResponse.success && assetResponse.asset) {
              const assetData = assetResponse.asset;
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: assetData.asset_id,
                  file_id: assetData.file_id,
                  storage_ref: assetData.storage_ref,
                  extension: assetData.extension,
                  filename: assetData.filename,
                  sourceType: assetData?.asset_type || '',
                  accountName: file.accountName,
                  propertyName: file.propertyName,
                  syncVersionName: file.syncVersionName,
                }
              });
            }
          } catch (error) {
            console.warn('Failed to fetch asset data for QnA:', error);
          }
        }

        // Add @selected files as asset content so backend can enrich and Morpheus can analyze
        // only the explicit assets the user chose.
        if (mentionedAssetIds && mentionedAssetIds.length > 0) {
          for (const mentionedId of mentionedAssetIds) {
            if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
            const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
            if (mentionedFile) {
              assetContentsList.push({
                type: 'asset',
                data: {
                  asset_id: mentionedId,
                  filename: mentionedFile.filename,
                  kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                  sourceType: mentionedFile?.sourceType || '',
                  accountName: mentionedFile.accountName,
                  propertyName: mentionedFile.propertyName,
                  syncVersionName: mentionedFile.syncVersionName,
                }
              });
            }
          }
        }

        // Add chart mention entries
        if (mentionedCharts && mentionedCharts.length > 0) {
          for (const chart of mentionedCharts) {
            assetContentsList.push({
              type: 'chart_mention',
              data: {
                component_id: chart.componentId,
                chart_id: chart.id,
                title: chart.title,
                chart_type: chart.type,
                config: chart.config,
                dashboard_id: editTargetDashboardId,
              }
            });
          }

          // Mark the mentioned charts as "applying" so each target card can
          // show an in-place overlay while Morpheus works. The mention
          // `componentId` (and `id`) match getComponentKey(component) because
          // both `component.id` and `component.component_config.id` are built
          // from the same source value during extraction (see project.tsx).
          const applyingKeys = mentionedCharts.flatMap((chart) =>
            [chart.componentId, chart.id].filter((value): value is string => Boolean(value))
          );
          // Persist the edit context so it survives an ask-first clarification
          // round-trip (the clarification answer is a separate store action).
          set({
            applyingComponentIds: new Set(applyingKeys),
            pendingEdit: { dashboardId: editTargetDashboardId, componentKeys: applyingKeys },
          });
        }

        if (assetContentsList.length > 0) {
          assetContents = assetContentsList;
        }

        const assetSelectionMetadata = explicitAssetIds.length > 0
          ? { asset_selection: 'explicit' as const, selected_asset_ids: explicitAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
          : { asset_selection: 'none' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };
	        const userNodeMetadata = {
	          ...assetSelectionMetadata,
	          ...promptThemeMetadata,
	        };
	        if (!isCurrentWorkflowRun(workflowConversationId)) return;

		        // Call processing service with file attachment if available
		        const startResult = await processingService.runProcessing(
		          projectId,
	          assetId,
          content,
          currentConversationId || undefined,  // Use existing conversation if available
	          assetContents,
	          userNodeMetadata,
	          model,
	          promptThemeId,
		          promptAnalysisFocusId
		        );
	        if (!isCurrentWorkflowRun(workflowConversationId)) return;

	        console.log('Q&A processing result:', startResult);

        if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
          // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
          if (onAccepted) onAccepted();
          const acceptedProjectName = startResult.data?.project_name;
          if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
            onProjectNameAccepted?.(acceptedProjectName.trim());
          }

		          const conversationId = startResult.data?.conversation_id || currentConversationId;
		          if (!conversationId) throw new Error('Accepted workflow did not return a conversation id.');
		          workflowConversationId = conversationId;
		          setCurrentConversationId(conversationId);

          // Stream live progress (falls back to polling if the stream is unavailable)
          const finalResult = await runWorkflowUpdates(
            '',  // No assetId for Q&A
            projectId,
	            conversationId,
	            (status) => {
	              if (!isCurrentWorkflowRun(conversationId)) return;
	              // Update status based on workflow status
	              const workflowStatus = status.data?.workflow_status?.status;

              // For QnA: DON'T update uploadedFile status to 'processing'
              // This prevents ProjectPage from showing "Generating Dashboard"
              // Keep status as 'uploaded' until QnA completes
              if (workflowStatus === 'error') {
                explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
              }

              if (workflowStatus === 'error' || workflowStatus === 'stopped') {
                setIsProcessing(false);
                // Workflow won't produce new data — drop the applying overlay
                // and the in-flight edit context.
                set({ applyingComponentIds: new Set<string>(), pendingEdit: null });
              }
              if (workflowStatus === 'stopped') {
                setIsTyping(false);
              }
              // Track current workflow step
              const step = status.data?.workflow_status?.metadata?.step;
              if (step) {
                setCurrentWorkflowStep(step);
                setPriorWorkflowSteps(getPriorWorkflowSteps(step));
              }
            },
            360,
            5000,
	            abortController.signal
	          );
	          if (!isCurrentWorkflowRun(conversationId)) return;

	          console.log('Q&A final result:', finalResult);

	          if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
	            try {
		              const { conversationService } = await import('@/services/conversationService');
		              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
		              if (!isCurrentWorkflowRun(conversationId)) return;
		              const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
	              if (restoredMessages.length) {
	                get().setMessages(restoredMessages);
	              }
	            } catch (error) {
	              console.error('Failed to load clarification request:', error);
	            }
	          } else if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	            if (promptTheme) {
	              persistPendingThemeSelection(null);
	              set({ isThemePending: false, isTemplatePending: false });
	            }
	            // Q&A response - check if it's a message or dashboard
	            if (finalResult.data?.dashboard_data) {
              // Dashboard response - load conversation to get LLM's actual response text
              try {
	                const { conversationService } = await import('@/services/conversationService');
	                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	                if (!isCurrentWorkflowRun(conversationId)) return;
	                const conversation = conversationResponse.conversation;

                // Extract dashboard_id from conversation. For an in-place edit we
                // stay on the dashboard the user was editing; otherwise (a new
                // dashboard generation) we open the conversation's latest.
                const dashboards = Array.isArray(conversation.dashboards) ? conversation.dashboards : [];
                const latestDashboard = dashboards[dashboards.length - 1];
                const dashboardId = editTargetDashboardId || (typeof latestDashboard?.dashboard_id === 'string' ? latestDashboard.dashboard_id : "");
                let editDashboardResponse: DashboardDataResponse | null = null;

	                // Set the dashboard as selected and update processedData
	                if (dashboardId) {
	                  set({ selectedDashboardId: dashboardId, isDashboardOpen: true });
	                  // On an edit the polled `dashboard_data` is the conversation's
	                  // latest dashboard, not the edited one — re-fetch the edited
	                  // dashboard by id so the panel shows the correct data.
	                  const fallbackResponse = dashboardResponseFromProcessing(finalResult.data);
	                  editDashboardResponse = await refetchEditedDashboardResponse(
	                    conversationId,
	                    projectId,
	                    editTargetDashboardId,
	                    fallbackResponse,
	                  );
	                  if (!isCurrentWorkflowRun(conversationId)) return;
	                  const editedDashboardData = (editDashboardResponse?.dashboard_data ?? finalResult.data.dashboard_data) as DashboardDataForView | null;
	                  const generatedTheme = resolveStoredTheme(
	                    editedDashboardData?.theme_id ?? null,
	                    editedDashboardData?.analysis_focus_id ?? null,
	                    editedDashboardData?.template_id ?? null,
	                  );
	                  const appliedTheme = promptTheme ?? generatedTheme;
	                  const themeId = getThemeId(appliedTheme);
	                  if (themeId) {
	                    saveDashboardThemeId(dashboardId, themeId);
	                  }
	                  persistPendingThemeSelection(null);
	                  set({
	                    selectedTheme: appliedTheme,
	                    selectedAnalysisFocusId: appliedTheme?.analysisFocusId ?? null,
	                    selectedTemplate: appliedTheme,
	                    isThemePending: false,
	                    isTemplatePending: false,
	                  });
                  // Update processedData with the new dashboard data (first file for display)
                  // Write to the file the dashboard view actually reads (matched by
                  // project + conversation), not just uploadedFiles[0] — otherwise
                  // project.tsx's sync effect can overwrite the fresh data with a
                  // different file's stale processedData.
                  const editFiles = get().uploadedFiles;
                  const editTargetFile = editFiles.find(f => f.projectId === projectId && f.conversationId === conversationId)
                    || editFiles.find(f => f.projectId === projectId)
                    || editFiles[0];
                  if (editTargetFile) {
                    updateFile(editTargetFile.fileID, { status: 'processed', processedData: editedDashboardData });
                  }

                  // New chart data has landed — drop the in-place applying
                  // overlay in the same tick the data renders so the existing
                  // `dashboard-component-highlight` pulse takes over seamlessly.
                  set({
                    applyingComponentIds: new Set<string>(),
                    pendingEdit: null,
                    editChangeSummary: editDashboardResponse?.change_summary ?? null,
                    editProvenance: editDashboardResponse?.computed_values ?? null,
                    analysisSteps: editDashboardResponse?.analysis_steps ?? null,
                  });

                  // Signal completion to UI for automatic rendering (unconditional)
                  if (onProcessedDataChange) {
                    onProcessedDataChange(editedDashboardData);
                  }

                }

                const firstFile = get().uploadedFiles[0];
                const restoredAttachmentFiles = get().uploadedFiles.map((file) => ({
                  id: file.fileID,
                  name: file.filename,
                  ext: file.ext,
                  sourceType: file.sourceType,
                  accountName: file.accountName,
                  propertyName: file.propertyName,
                  syncVersionName: file.syncVersionName,
                }));
                const restoredMessages = conversationNodesToMessages(conversation, {
                  sourceFileName: firstFile?.filename || 'dashboard',
                  lastUserMessageAttachment: firstFile ? {
                    kind: 'csv',
                    name: restoredAttachmentFiles.length > 1 ? `${restoredAttachmentFiles.length} files` : firstFile.filename,
                    mime: 'text/csv',
                    sourceType: restoredAttachmentFiles.length > 1 ? 'Multiple' : firstFile.sourceType,
                    accountName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.accountName,
                    propertyName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.propertyName,
                    syncVersionName: restoredAttachmentFiles.length > 1 ? undefined : firstFile.syncVersionName,
                    files: restoredAttachmentFiles,
                  } : undefined
                });
                if (restoredMessages.length) {
                  const lastRestored = restoredMessages[restoredMessages.length - 1];

                  // Case 1: Last message is assistant with dashboardCard but empty content
                  if (lastRestored?.role === 'assistant' && lastRestored.dashboardCard && !lastRestored.content) {
                    const prevUserMsg = [...restoredMessages].reverse().find(m => m.role === 'user' && m.chartMentions?.length);
                    if (prevUserMsg?.chartMentions?.length) {
                      const chartNames = prevUserMsg.chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      lastRestored.content = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    } else {
                      lastRestored.content = 'Your dashboard has been updated with the requested changes.';
                    }
                  }

                  // Case 2: Last message is a user message — backend's assistant node was filtered out
                  // (no text, no dashboard content). Synthesize a response.
                  if (lastRestored?.role === 'user') {
                    const chartMentions = lastRestored.chartMentions;
                    let responseContent = 'Your dashboard has been updated with the requested changes.';
                    if (chartMentions?.length) {
                      const chartNames = chartMentions.map(c => c.title).filter(Boolean).join(', ');
                      responseContent = `Done! I've updated ${chartNames || 'the chart'}. The dashboard has been refreshed with your changes.`;
                    }
                    restoredMessages.push({
                      id: (Date.now() + 1).toString(),
                      role: 'assistant',
                      content: responseContent,
                      dashboardCard: {
                        sourceFileName: get().uploadedFiles[0]?.filename || 'dashboard',
                        dashboardId: dashboardId,
                        dashboardTitle: latestDashboard?.title || undefined,
                        accountName: get().uploadedFiles[0]?.accountName,
                        sourceType: get().uploadedFiles[0]?.sourceType,
                      },
                      timestamp: new Date(),
                    });
                  }

                  get().setMessages(restoredMessages);
                  if (editTargetDashboardId) {
                    get().upsertEditCompletionMessage({
                      dashboardId,
                      dashboardTitle: latestDashboard?.title || undefined,
                      sourceFileName: firstFile?.filename || 'dashboard',
                      accountName: firstFile?.accountName,
                      sourceType: firstFile?.sourceType,
                      summary: editDashboardResponse?.change_summary ?? null,
                      provenance: editDashboardResponse?.computed_values ?? null,
                      editNote: editDashboardResponse?.edit_note ?? null,
                    });
                  }
                }
	              } catch (error) {
	                if (!isCurrentWorkflowRun(conversationId)) return;
	                console.error('Failed to load conversation for dashboard response:', error);
                // No fallback message
                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 2).toString(),
                    role: 'assistant',
                    content: "",
                    dashboardCard: {
                      sourceFileName: get().uploadedFiles[0]?.filename || "dashboard",
                      dashboardId: "",
                      accountName: get().uploadedFiles[0]?.accountName,
                      sourceType: get().uploadedFiles[0]?.sourceType,
                    },
                    timestamp: new Date(),
                  }
                ]));
              }
	            } else {
	              // Q&A text response - load conversation and show all nodes in workflow order
	              if (promptTheme) {
	                persistPendingThemeSelection(null);
	                set({ isThemePending: false, isTemplatePending: false });
	              }
	              try {
	                const { conversationService } = await import('@/services/conversationService');
	                const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	                if (!isCurrentWorkflowRun(conversationId)) return;
	                const conversation = conversationResponse.conversation;
                const restoredMessages = conversationNodesToMessages(conversation);
                if (restoredMessages.length) {
                  get().setMessages(restoredMessages);
                  set({ analysisSteps: finalResult.data?.analysis_steps ?? null });

                  // Auto-open dashboard if the latest message includes a dashboard card
                  const lastMsg = restoredMessages[restoredMessages.length - 1];
                  const dashId = lastMsg?.dashboardCard?.dashboardId;
                  if (dashId) {
                    set({
                      isDashboardOpen: true,
                      hasShownInitialDashboard: true,
                      isInitialLoading: false,
                    });
	                    get().selectDashboard(dashId, projectId).then((data) => {
	                      if (data && onProcessedDataChange && isCurrentWorkflowRun(conversationId)) {
	                        onProcessedDataChange(data);
	                      }
	                    });
                  }
                }
                // Update file status to processed to hide chip
                get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'processed' }));
	              } catch (error) {
	                if (!isCurrentWorkflowRun(conversationId)) return;
	                console.error('Failed to load conversation for Q&A response:', error);
                // Fallback to workflow status metadata
                const workflowStatus = finalResult.data?.workflow_status;
                const responseText = workflowStatus?.metadata?.content ||
                  finalResult.data?.message ||
                  "I've processed your question.";

                updateMessages((prev) => ([
                  ...prev,
                  {
                    id: (Date.now() + 1).toString(),
                    role: 'assistant',
                    content: responseText,
                    timestamp: new Date(),
                  }
                ]));
              }
            }
          } else if (finalResult.data?.status === 'error') {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your question.';
            explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        } else {
          const errorMsg = startResult.data?.error || 'Failed to start processing.';
          updateMessages((prev) => ([
            ...prev,
            {
              id: (Date.now() + 1).toString(),
              role: 'assistant',
              content: 'Error while generating dashboard',
              timestamp: new Date(),
              isError: true,
            }
          ]));
        }
	      } catch (error) {
	        if (!isCurrentWorkflowRun(workflowConversationId)) return;
	        console.error('Q&A processing error:', error);
	        explicitPromptFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
        const errObj = error as Record<string, unknown>;
        const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
        const isInsufficientCredits =
          errObj?.status === 402 ||
          (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
          (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
            isInsufficientCredits,
          }
	        ]));
	      } finally {
	        if (isWorkflowRunActive(workflowRunId) && isSameWorkflowContext(workflowConversationId)) {
	          setIsTyping(false);
	          setIsProcessing(false);
	          // Safety net: ensure the applying overlay never gets stuck if the
	          // workflow exits without landing new data (it's already cleared in
	          // the data-applied and error/stopped paths above).
	          set({ isUpdatingDashboard: false, abortController: null, ...(get().pendingEdit ? {} : { applyingComponentIds: new Set<string>() }) });
	          finishWorkflowRun(workflowRunId);
	        }
	      }
      return;
    }

    // Check if user message with this content already exists
    const firstUploadedFile = freshPromptUploads[0];
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== 'user' || lastMessage.content !== content.trim()) {
      // User message doesn't exist, add it
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: content.trim(),
        timestamp: new Date(),
        attachment: activeFileAttachment || buildAttachmentFromFiles(explicitPromptFiles),
	        chartMentions: mentionedCharts && mentionedCharts.length > 0
	          ? mentionedCharts.map(c => ({ title: c.title, type: c.type, componentId: c.componentId || c.id }))
	          : undefined,
	        template: promptTheme || undefined,
	      };
      addMessage(userMessage);
    }

    // Get updated messages after adding user message
    const updatedMessages = get().messages;
    setIsTyping(true);
    setIsProcessing(true);

    try {
      // Start processing with user prompt - set all files to processing
      set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => isFreshPromptUpload(f) ? { ...f, status: 'processing' as const } : f) }));
      const projectId = projectIdParam || firstUploadedFile.projectId;
      if (!projectId) {
        throw new Error('Project context missing for uploaded file');
      }

      console.log('Starting processing for fileIDs:', freshPromptUploads.map(f => f.fileID));
      const freshUploadsForProcessing = freshPromptUploads;
      // Chart mentions mark this as an in-place edit of the currently-viewed
      // dashboard — capture its id so the completion handler stays on it instead
      // of jumping to the conversation's latest. Null when not an edit.
      const editTargetDashboardId = mentionedCharts && mentionedCharts.length > 0
        ? get().selectedDashboardId ?? null
        : null;
      const assetContentsList: ConversationChatRequest['user_node_contents'] = [];
      for (const file of freshUploadsForProcessing) {
        try {
          const { fileService } = await import('@/services/fileService');
          const assetResponse = await fileService.getAsset(file.fileID);
          if (assetResponse.success && assetResponse.asset) {
            const assetData = assetResponse.asset;
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: assetData.asset_id,
                file_id: assetData.file_id,
                storage_ref: assetData.storage_ref,
                extension: assetData.extension,
                filename: assetData.filename,
                sourceType: assetData?.asset_type || '',
                accountName: file.accountName,
                propertyName: file.propertyName,
                syncVersionName: file.syncVersionName,
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch asset data:', error);
        }
      }

      // Add @selected files as asset content so backend can enrich and Morpheus can analyze
      // only the explicit assets the user chose.
      if (mentionedAssetIds && mentionedAssetIds.length > 0) {
        for (const mentionedId of mentionedAssetIds) {
          if (assetContentsList.some(c => c.data?.asset_id === mentionedId)) continue;
          const mentionedFile = uploadedFiles.find(f => f.fileID === mentionedId);
          if (mentionedFile) {
            assetContentsList.push({
              type: 'asset',
              data: {
                asset_id: mentionedId,
                filename: mentionedFile.filename,
                kind: mentionedFile.ext === 'csv' ? 'csv' : 'file',
                sourceType: mentionedFile?.sourceType || '',
                accountName: mentionedFile.accountName,
                propertyName: mentionedFile.propertyName,
                syncVersionName: mentionedFile.syncVersionName,
              }
            });
          }
        }
      }

      // Add chart mention entries (second code path)
      if (mentionedCharts && mentionedCharts.length > 0) {
        for (const chart of mentionedCharts) {
          assetContentsList.push({
            type: 'chart_mention',
            data: {
              component_id: chart.componentId,
              chart_id: chart.id,
              title: chart.title,
              chart_type: chart.type,
              config: chart.config,
              dashboard_id: editTargetDashboardId,
            }
          });
        }
      }

      const assetContents = assetContentsList.length > 0 ? assetContentsList : undefined;
	      const assetSelectionMetadata = explicitAssetIds.length > 0
	        ? { asset_selection: 'explicit' as const, selected_asset_ids: explicitAssetIds, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) }
	        : { asset_selection: 'none' as const, ...(mentionedCharts && mentionedCharts.length > 0 ? { selected_chart_ids: mentionedCharts.map(c => c.componentId) } : {}) };
		      const userNodeMetadata = {
		        ...assetSelectionMetadata,
		        ...promptThemeMetadata,
		      };
	      if (!isCurrentWorkflowRun(workflowConversationId)) return;

		      const startResult = await processingService.runProcessing(
		        projectId,
	        firstUploadedFile.fileID,
        content,
        firstUploadedFile.conversationId || currentConversationId || undefined,
	        assetContents,
	        userNodeMetadata,
	        model,
	        promptThemeId,
		        promptAnalysisFocusId
		      );
	      if (!isCurrentWorkflowRun(workflowConversationId)) return;
	      console.log('Run processing result:', startResult);
      // processing or accepted
      if (startResult.data?.success && (startResult.data?.status === 'processing' || startResult.data?.status === 'accepted')) {
        // Invoke onAccepted callback to allow early UI updates (e.g. credit refresh)
        if (onAccepted) onAccepted();
        const acceptedProjectName = startResult.data?.project_name;
        if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
          onProjectNameAccepted?.(acceptedProjectName.trim());
        }

		        const conversationId = startResult.data?.conversation_id;
		        if (!conversationId) throw new Error('Accepted workflow did not return a conversation id.');
		        workflowConversationId = conversationId;
		        set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, conversationId })), currentConversationId: conversationId }));
		        setCurrentConversationId(conversationId);

        console.log('Processing started, beginning polling...');
        const finalResult = await runWorkflowUpdates(
          firstUploadedFile.fileID,
	          projectId,
	          conversationId,
	          (status) => {
	            if (!isCurrentWorkflowRun(conversationId)) return;
	            const workflowStatus = status.data?.workflow_status?.status;
            if (workflowStatus === 'processing') {
              set((s) => ({ uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: 'processing' as const })) }));
            } else if (workflowStatus === 'error' || workflowStatus === 'stopped') {
              const newStatus = workflowStatus === 'stopped' ? 'processed' : 'error';
              set((s) => ({
                uploadedFiles: s.uploadedFiles.map(f => ({ ...f, status: newStatus }))
              }));
            }
            if (workflowStatus === 'stopped') {
              setIsProcessing(false);
              setIsTyping(false);
            }
            const step = status.data?.workflow_status?.metadata?.step;
            if (step) {
              setCurrentWorkflowStep(step);
              setPriorWorkflowSteps(getPriorWorkflowSteps(step));
            }
          },
          360, // max attempts (30 minutes)
          5000, // 5 second intervals
	          abortController.signal
	        );
	        if (!isCurrentWorkflowRun(conversationId)) return;
	        console.log('Final polling result:', finalResult);

	        if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
	          try {
		            const { conversationService } = await import('@/services/conversationService');
		            const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
		            if (!isCurrentWorkflowRun(conversationId)) return;
		            const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
	            if (restoredMessages.length) {
	              get().setMessages(restoredMessages);
	            }
	          } catch (error) {
	            console.error('Failed to load clarification request:', error);
	          }
	        } else if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	          if (promptTheme) {
	            persistPendingThemeSelection(null);
	            set({ isThemePending: false, isTemplatePending: false });
	          }
	          if (finalResult.data?.dashboard_data) {
            const files = get().uploadedFiles;
            if (files.length > 0) {
              updateFile(files[0].fileID, { status: 'processed', processedData: finalResult.data?.dashboard_data });
            }
            // Load conversation to get LLM's actual response text and dashboard_id
            try {
	              const { conversationService } = await import('@/services/conversationService');
	              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	              if (!isCurrentWorkflowRun(conversationId)) return;
	              const conversation = conversationResponse.conversation;

              // Extract dashboard_id from conversation. For an in-place edit we
              // stay on the dashboard the user was editing; otherwise (a new
              // dashboard generation) we open the conversation's latest.
              const dashboards = Array.isArray(conversation.dashboards) ? conversation.dashboards : [];
              const latestDashboard = dashboards[dashboards.length - 1];
              const dashboardId = editTargetDashboardId || (typeof latestDashboard?.dashboard_id === 'string' ? latestDashboard.dashboard_id : "");
              let editDashboardResponse: DashboardDataResponse | null = null;

              // Set the dashboard as selected and update processedData
              if (dashboardId) {
                // On an edit the polled `dashboard_data` is the conversation's
                // latest dashboard, not the edited one — re-fetch the edited
                // dashboard by id so the panel shows the correct data.
                const fallbackResponse = dashboardResponseFromProcessing(finalResult.data);
                editDashboardResponse = await refetchEditedDashboardResponse(
                  conversationId,
                  projectId,
                  editTargetDashboardId,
                  fallbackResponse,
                );
                if (!isCurrentWorkflowRun(conversationId)) return;
                const editedDashboardData = (editDashboardResponse?.dashboard_data ?? finalResult.data.dashboard_data) as DashboardDataForView | null;
                // Auto open the dashboard FIRST, before signaling data
                set({
                  selectedDashboardId: dashboardId,
                  isDashboardOpen: true,
                  hasShownInitialDashboard: true,
                  isInitialLoading: false,
                  editChangeSummary: editDashboardResponse?.change_summary ?? null,
                  editProvenance: editDashboardResponse?.computed_values ?? null,
                  analysisSteps: editDashboardResponse?.analysis_steps ?? null,
                });
                const files = get().uploadedFiles;
                // Target the file the dashboard view reads (project + conversation),
                // falling back to [0], so the sync effect doesn't clobber fresh data.
                const editTargetFile = files.find(f => f.projectId === projectId && f.conversationId === conversationId)
                  || files.find(f => f.projectId === projectId)
                  || files[0];
                if (editTargetFile) {
                  updateFile(editTargetFile.fileID, { processedData: editedDashboardData });
                }
                // Signal completion to UI for automatic rendering
                if (onProcessedDataChange) {
                  onProcessedDataChange(editedDashboardData);
                }

	                const generatedTheme = resolveStoredTheme(
	                  editedDashboardData?.theme_id ?? null,
	                  editedDashboardData?.analysis_focus_id ?? null,
	                  editedDashboardData?.template_id ?? null,
	                );
	                const appliedTheme = promptTheme ?? generatedTheme;
	                const themeId = getThemeId(appliedTheme);
	                if (dashboardId && themeId) {
	                  saveDashboardThemeId(dashboardId, themeId);
	                }
	                persistPendingThemeSelection(null);
	                set({
	                  selectedTheme: appliedTheme,
	                  selectedAnalysisFocusId: appliedTheme?.analysisFocusId ?? null,
	                  selectedTemplate: appliedTheme,
	                  isThemePending: false,
	                  isTemplatePending: false,
	                });
              }

              const currentFiles = get().uploadedFiles;
              const restoredAttachmentFiles = currentFiles.map((file) => ({
                id: file.fileID,
                name: file.filename,
                ext: file.ext,
                sourceType: file.sourceType,
                accountName: file.accountName,
                propertyName: file.propertyName,
                syncVersionName: file.syncVersionName,
              }));
              const restoredMessages = conversationNodesToMessages(conversation, {
                sourceFileName: currentFiles[0]?.filename ?? 'dashboard',
                lastUserMessageAttachment: currentFiles[0] ? {
                  kind: 'csv',
                  name: restoredAttachmentFiles.length > 1 ? `${restoredAttachmentFiles.length} files` : currentFiles[0].filename,
                  sourceType: restoredAttachmentFiles.length > 1 ? 'Multiple' : currentFiles[0].sourceType,
                  accountName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].accountName,
                  propertyName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].propertyName,
                  syncVersionName: restoredAttachmentFiles.length > 1 ? undefined : currentFiles[0].syncVersionName,
                  files: restoredAttachmentFiles,
                } : undefined,
              });
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
                if (editTargetDashboardId) {
                  get().upsertEditCompletionMessage({
                    dashboardId,
                    dashboardTitle: latestDashboard?.title || undefined,
                    sourceFileName: currentFiles[0]?.filename ?? 'dashboard',
                    accountName: currentFiles[0]?.accountName,
                    sourceType: currentFiles[0]?.sourceType,
                    summary: editDashboardResponse?.change_summary ?? null,
                    provenance: editDashboardResponse?.computed_values ?? null,
                    editNote: editDashboardResponse?.edit_note ?? null,
                  });
                }
              }

              // DON'T clear uploadedFile - ProjectPage needs it to determine dashboard display
              // The FilePreviewChip will be hidden based on processing status
              // setUploadedFile(null); // REMOVED - causes dashboard to disappear in ProjectPage
	            } catch (error) {
	              if (!isCurrentWorkflowRun(conversationId)) return;
	              console.error('Failed to load conversation for dashboard response:', error);
              // No fallback message
              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 3).toString(),
                  role: 'assistant',
                  content: "",
                  dashboardCard: {
                    sourceFileName: get().uploadedFiles[0]?.filename ?? "dashboard",
                    dashboardId: "",
                    accountName: get().uploadedFiles[0]?.accountName,
                    sourceType: get().uploadedFiles[0]?.sourceType,
                  },
                  timestamp: new Date(),
                }
              ]));

              // DON'T clear uploadedFile - see comment above
              // setUploadedFile(null); // REMOVED
            }

            if (conversationId) {
              setCurrentConversationId(conversationId);
            }
	          } else {
	            // Q&A text response (with @mentioned file) - load conversation and show response
	            console.log('Q&A response detected (no dashboard_data) - loading conversation');
	            if (promptTheme) {
	              persistPendingThemeSelection(null);
	              set({ isThemePending: false, isTemplatePending: false });
	            }
	            try {
	              const { conversationService } = await import('@/services/conversationService');
	              const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	              if (!isCurrentWorkflowRun(conversationId)) return;
	              const conversation = conversationResponse.conversation;
              const restoredMessages = conversationNodesToMessages(conversation);
              console.log('Q&A conversation loaded, restored', restoredMessages.length, 'messages');
              if (restoredMessages.length) {
                get().setMessages(restoredMessages);
                set({ analysisSteps: finalResult.data?.analysis_steps ?? null });

                // Auto-open dashboard if the latest message includes a dashboard card
                const lastMsg = restoredMessages[restoredMessages.length - 1];
                const dashId = lastMsg?.dashboardCard?.dashboardId;
                if (dashId) {
                  set({
                    isDashboardOpen: true,
                    hasShownInitialDashboard: true,
                    isInitialLoading: false,
                  });
	                  get().selectDashboard(dashId, projectId).then((data) => {
	                    if (data && onProcessedDataChange && isCurrentWorkflowRun(conversationId)) {
	                      onProcessedDataChange(data);
	                    }
	                  });
                }
              }
	            } catch (error) {
	              if (!isCurrentWorkflowRun(conversationId)) return;
	              console.error('Failed to load conversation for Q&A response:', error);
              // Fallback to workflow status metadata
              const workflowStatus = finalResult.data?.workflow_status;
              const responseText = workflowStatus?.metadata?.content ||
                finalResult.data?.message ||
                "I've processed your question.";

              updateMessages((prev) => ([
                ...prev,
                {
                  id: (Date.now() + 1).toString(),
                  role: 'assistant',
                  content: responseText,
                  timestamp: new Date(),
                }
              ]));
            }
          }
        } else {
          // Explicitly handle error status from polling
          if (finalResult.data?.status === 'error' || !finalResult.success) {
            const errorMsg = finalResult.data?.error || 'An error occurred while processing your request.';
            get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));

            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          } else {
            // Timeout or unknown state — show explicit error to user
            const timeoutMsg = finalResult.data?.error || 'Processing timed out. Please try again.';
            updateMessages((prev) => ([
              ...prev,
              {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: 'Error while generating dashboard',
                timestamp: new Date(),
                isError: true,
              }
            ]));
          }
        }
      } else {
        // startResult failed — show error to user
        const startErrorMsg = startResult.data?.error || 'Failed to start processing.';
        updateMessages((prev) => ([
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: 'Error while generating dashboard',
            timestamp: new Date(),
            isError: true,
          }
        ]));
      }
	    } catch (error) {
	      if (!isCurrentWorkflowRun(workflowConversationId)) return;
	      console.error('Processing error:', error);
	      get().uploadedFiles.forEach(f => updateFile(f.fileID, { status: 'error' }));
      const errObj = error as Record<string, unknown>;
      const errDetail = (errObj?.response as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
      const isInsufficientCredits =
        errObj?.status === 402 ||
        (errDetail as Record<string, unknown> | undefined)?.error === 'insufficient_credits' ||
        (errObj?.detail as Record<string, unknown> | undefined)?.error === 'insufficient_credits';
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error while generating dashboard',
          timestamp: new Date(),
          isError: true,
          isInsufficientCredits,
        }
	      ]));
	    } finally {
	      if (isWorkflowRunActive(workflowRunId) && isSameWorkflowContext(workflowConversationId)) {
	        setIsTyping(false);
	        setIsProcessing(false);
	        set({ isUpdatingDashboard: false, abortController: null });
	        finishWorkflowRun(workflowRunId);
	      }
	    }
  },

  submitClarificationResponse: async (
    answers: ClarificationAnswer[],
    projectId: string,
    onProcessedDataChange?: (data: unknown) => void,
    model?: 'pro' | 'fast',
    onAccepted?: () => void,
    onProjectNameAccepted?: (projectName: string) => void,
  ) => {
    if (answers.length === 0) return;
    const state = get();
    const {
      currentConversationId,
      setIsProcessing,
      setIsTyping,
      setCurrentWorkflowStep,
      setPriorWorkflowSteps,
      setCurrentConversationId,
      updateMessages,
	    } = state;
	    const promptTheme = getPendingPromptTheme(state);
	    const promptThemeId = getThemeId(promptTheme);
	    const promptAnalysisFocusId = getAnalysisFocusId(promptTheme);
	    const promptThemeMetadata = getPromptThemeMetadata(promptTheme);
	    if (!currentConversationId) {
	      throw new Error('Conversation context missing for clarification response');
	    }

	    // Edit continuation: this clarification answers an in-flight chart/table
	    // edit. Re-engage the per-chart shimmer for the answer-run (it was set
	    // when the edit was first sent and persisted across the clarification).
	    const pendingEdit = get().pendingEdit;
	    if (pendingEdit && pendingEdit.componentKeys.length > 0) {
	      set({ applyingComponentIds: new Set(pendingEdit.componentKeys) });
	    }

	    const workflowRunId = beginWorkflowRun();
	    const abortController = new AbortController();
	    let workflowConversationId = currentConversationId;
	    const isSameWorkflowContext = (conversationId?: string | null) => {
	      const current = get();
	      if (current.currentProjectId !== projectId) return false;
	      if (conversationId && current.currentConversationId !== conversationId) return false;
	      return true;
	    };
	    const isCurrentWorkflowRun = (conversationId?: string | null) => (
	      isWorkflowRunActive(workflowRunId) &&
	      !abortController.signal.aborted &&
	      isSameWorkflowContext(conversationId)
	    );
	    set({ abortController, currentProjectId: projectId, thinkingEvents: [], priorWorkflowSteps: [], isStreamingWorkflow: false, analysisSteps: null });
    setCurrentWorkflowStep(null);
    setPriorWorkflowSteps([]);

    const selectedAssetIds = getAnswersAssetIds(answers);
    const selectionMode = getAnswersSelectionMode(answers, selectedAssetIds);
    const assetAnswer = answers.find(({ option }) => getClarificationAssetIds(option).length > 0);
    const clarificationAttachment = assetAnswer
      ? buildClarificationAttachment(assetAnswer.option)
      : undefined;
    const displayText = answers
      .map(({ option, freeText }) => (freeText ? `${option.label}\n${freeText}` : option.label))
      .join('\n');
    const clarificationIds = answers.map(({ request }) => request.clarification_id);

    updateMessages((prev) => ([
      ...prev,
      {
        id: Date.now().toString(),
	        role: 'user',
	        content: displayText,
	        timestamp: new Date(),
	        attachment: clarificationAttachment,
	        template: promptTheme || undefined,
	      },
	    ]));

    setIsTyping(true);
    setIsProcessing(true);

	    try {
		      const startResult = await processingService.runProcessing(
	        projectId,
	        null,
        displayText,
        currentConversationId,
        createClarificationResponseContents(answers),
        {
	          asset_selection: selectionMode,
	          ...(selectedAssetIds.length > 0 ? { selected_asset_ids: selectedAssetIds } : {}),
	          clarification_id: clarificationIds[0],
	          clarification_ids: clarificationIds,
	          ...promptThemeMetadata,
	        },
	        model,
	        promptThemeId,
		        promptAnalysisFocusId,
		      );
	      if (!isCurrentWorkflowRun(workflowConversationId)) return;

	      if (!(startResult.data?.success && (startResult.data.status === 'processing' || startResult.data.status === 'accepted'))) {
        throw new Error(startResult.data?.error || 'Failed to submit clarification response');
      }

      onAccepted?.();
      const acceptedProjectName = startResult.data?.project_name;
      if (typeof acceptedProjectName === 'string' && acceptedProjectName.trim()) {
        onProjectNameAccepted?.(acceptedProjectName.trim());
      }

	      const conversationId = startResult.data?.conversation_id || currentConversationId;
	      workflowConversationId = conversationId;
	      setCurrentConversationId(conversationId);

      const finalResult = await runWorkflowUpdates(
        '',
	        projectId,
	        conversationId,
	        (status) => {
	          if (!isCurrentWorkflowRun(conversationId)) return;
	          const workflowStatus = status.data?.workflow_status?.status;
          if (workflowStatus === 'error' || workflowStatus === 'stopped' || workflowStatus === 'awaiting_user_input') {
            setIsProcessing(false);
            setIsTyping(false);
          }
          const step = status.data?.workflow_status?.metadata?.step;
          if (step) {
            setCurrentWorkflowStep(step);
            setPriorWorkflowSteps(getPriorWorkflowSteps(step));
          }
        },
        360,
        5000,
	        abortController.signal,
	      );
	      if (!isCurrentWorkflowRun(conversationId)) return;

		      if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	        if (promptTheme) {
	          persistPendingThemeSelection(null);
	          set({ isThemePending: false, isTemplatePending: false });
	        }
		        const { conversationService } = await import('@/services/conversationService');
	        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	        if (!isCurrentWorkflowRun(conversationId)) return;
	        const conversation = conversationResponse.conversation;
        const restoredMessages = conversationNodesToMessages(conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }
        set({ analysisSteps: finalResult.data?.analysis_steps ?? null });
        const lastMsg = restoredMessages[restoredMessages.length - 1];
        const dashId = lastMsg?.dashboardCard?.dashboardId;
        // Edit continuation: update the edited dashboard IN PLACE (same id)
        // so the chart/table reflects the change with no F5, instead of
        // jumping to the conversation's latest dashboard.
        if (pendingEdit) {
          const editTargetDashboardId = pendingEdit.dashboardId || dashId || null;
          if (editTargetDashboardId) {
            set({ selectedDashboardId: editTargetDashboardId, isDashboardOpen: true, hasShownInitialDashboard: true, isInitialLoading: false });
          }
          const fallbackResponse = dashboardResponseFromProcessing(finalResult.data);
          const editedResponse = await refetchEditedDashboardResponse(
            conversationId,
            projectId,
            editTargetDashboardId,
            fallbackResponse,
          );
          if (!isCurrentWorkflowRun(conversationId)) return;
          const editedData = editedResponse?.dashboard_data ?? null;
          if (editedData) {
            writeProcessedDataToViewFile(get().uploadedFiles, projectId, conversationId, editedData, get().updateFile);
          }
          set({
            applyingComponentIds: new Set<string>(),
            pendingEdit: null,
            editChangeSummary: editedResponse?.change_summary ?? null,
            editProvenance: editedResponse?.computed_values ?? null,
            analysisSteps: editedResponse?.analysis_steps ?? null,
          });
          const dashboards = Array.isArray(conversation.dashboards) ? conversation.dashboards : [];
          const editedDashboard = dashboards.find((dashboard) => dashboard?.dashboard_id === editTargetDashboardId);
          const firstFile = get().uploadedFiles[0];
          get().upsertEditCompletionMessage({
            dashboardId: editTargetDashboardId,
            dashboardTitle: editedDashboard?.title || undefined,
            sourceFileName: firstFile?.filename || 'dashboard',
            accountName: firstFile?.accountName,
            sourceType: firstFile?.sourceType,
            summary: editedResponse?.change_summary ?? null,
            provenance: editedResponse?.computed_values ?? null,
            editNote: editedResponse?.edit_note ?? null,
          });
          if (editedData && onProcessedDataChange) {
            onProcessedDataChange(editedData);
          }
          return;
        }
        if (dashId) {
          set({
            isDashboardOpen: true,
            hasShownInitialDashboard: true,
            isInitialLoading: false,
          });
	          get().selectDashboard(dashId, projectId).then((data) => {
	            if (data && onProcessedDataChange && isCurrentWorkflowRun(conversationId)) {
	              onProcessedDataChange(data);
	            }
	          });
        }
      } else if (finalResult.data?.success && finalResult.data?.status === 'awaiting_user_input') {
	        const { conversationService } = await import('@/services/conversationService');
	        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	        if (!isCurrentWorkflowRun(conversationId)) return;
	        const restoredMessages = conversationNodesToMessages(conversationResponse.conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }
      } else if (finalResult.data?.status === 'error' || !finalResult.success) {
        throw new Error(finalResult.data?.error || 'Clarification response processing failed');
      }
	    } catch (error) {
	      if (!isCurrentWorkflowRun(workflowConversationId)) return;
	      console.error('Clarification response error:', error);
      updateMessages((prev) => ([
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'assistant',
          content: 'Error while processing your selection',
          timestamp: new Date(),
          isError: true,
        },
      ]));
	    } finally {
	      if (isWorkflowRunActive(workflowRunId) && isSameWorkflowContext(workflowConversationId)) {
	        setIsTyping(false);
	        setIsProcessing(false);
	        set({ abortController: null });
	        finishWorkflowRun(workflowRunId);
	      }
	    }
  },

	  resumeWorkflowPolling: async (projectId: string, conversationId: string, onProcessedDataChange?: (data: unknown) => void) => {
	    // Pre-check (synchronous): processFileWithMessage sets abortController synchronously
	    // before its first await, so this catches concurrent fresh-start workflows
	    if (get().abortController !== null || get().isProcessing) return;

	    const workflowRunId = beginWorkflowRun();
	    const abortController = new AbortController();
	    const isSameWorkflowContext = () => {
	      const current = get();
	      return current.currentProjectId === projectId && current.currentConversationId === conversationId;
	    };
	    const isCurrentWorkflowRun = () => (
	      isWorkflowRunActive(workflowRunId) &&
	      !abortController.signal.aborted &&
	      isSameWorkflowContext()
	    );
	    set({ abortController, currentProjectId: projectId });

	    const { setIsProcessing, setIsTyping, setCurrentWorkflowStep, setCurrentConversationId } = get();

	    try {
	      const { processingService } = await import('@/services/processingService');
	      if (!isCurrentWorkflowRun()) return;

	      // Check if a workflow is actually in progress before doing anything
	      const statusCheck = await processingService.getWorkflowStatus(conversationId, projectId, abortController.signal);
	      if (!isCurrentWorkflowRun()) return;
	      if (statusCheck.data?.status !== 'processing') {
	        // Not actively processing (completed, error, stopped, starting/404) — nothing to resume
	        return;
	      }

	      // Seed the step display with whatever the backend currently reports
	      const initialStep = statusCheck.data?.workflow_status?.metadata?.step;
	      if (initialStep) {
	        setCurrentWorkflowStep(initialStep);
	        // Compute all steps that logically preceded this one so the UI can show them as completed
	        set({ priorWorkflowSteps: getPriorWorkflowSteps(initialStep) });
	      }

	      set({ isProcessing: true, isTyping: true });
	      setCurrentConversationId(conversationId);

	      const finalResult = await runWorkflowUpdates(
	        '',
	        projectId,
	        conversationId,
	        (status) => {
	          if (!isCurrentWorkflowRun()) return;
	          const workflowStatus = status.data?.workflow_status?.status;
          if (workflowStatus === 'error' || workflowStatus === 'stopped') {
            setIsProcessing(false);
            setIsTyping(false);
          }
          const step = status.data?.workflow_status?.metadata?.step;
          if (step) {
            setCurrentWorkflowStep(step);
            set({ priorWorkflowSteps: getPriorWorkflowSteps(step) });
          }
        },
        360,
	        5000,
	        abortController.signal
	      );
	      if (!isCurrentWorkflowRun()) return;

	      if (finalResult.data?.success && finalResult.data?.status === 'completed') {
	        const { conversationService } = await import('@/services/conversationService');
	        const { conversationNodesToMessages } = await import('@/chat/conversationToMessages');
	        const conversationResponse = await conversationService.loadConversation(conversationId, projectId);
	        if (!isCurrentWorkflowRun()) return;
	        const conversation = conversationResponse.conversation;
        const restoredMessages = conversationNodesToMessages(conversation);
        if (restoredMessages.length) {
          get().setMessages(restoredMessages);
        }
        set({ analysisSteps: finalResult.data?.analysis_steps ?? null });

        // Auto-open dashboard if the latest message has a dashboard card
        const lastMsg = restoredMessages[restoredMessages.length - 1];
        const dashId = lastMsg?.dashboardCard?.dashboardId;
        if (dashId) {
          const restoredThemeOnResume = resolveStoredTheme(getThemeIdForDashboard(dashId), null, getLegacyTemplateIdForDashboard(dashId));
          set({
            selectedDashboardId: dashId,
            isDashboardOpen: true,
            hasShownInitialDashboard: true,
            isInitialLoading: false,
            selectedTheme: restoredThemeOnResume,
            selectedAnalysisFocusId: restoredThemeOnResume?.analysisFocusId ?? null,
            selectedTemplate: restoredThemeOnResume,
            isThemePending: false,
            isTemplatePending: false,
          });
	          get().selectDashboard(dashId, projectId).then((data) => {
	            if (data && onProcessedDataChange && isCurrentWorkflowRun()) onProcessedDataChange(data);
	          });
	        } else if (finalResult.data?.dashboard_data && onProcessedDataChange && isCurrentWorkflowRun()) {
	          onProcessedDataChange(finalResult.data.dashboard_data);
	        }
	      }
	    } catch (error) {
	      if (!isCurrentWorkflowRun()) return;
	      console.error('Failed to resume workflow polling:', error);
	    } finally {
	      if (isWorkflowRunActive(workflowRunId) && isSameWorkflowContext()) {
	        setIsTyping(false);
	        setIsProcessing(false);
	        set({ abortController: null });
	        finishWorkflowRun(workflowRunId);
	      }
	    }
	  },

  stopGeneration: async () => {
    const state = get();
    const { abortController, currentConversationId, setIsProcessing, setIsTyping } = state;

    // Abort the polling if controller exists
	    if (abortController && !abortController.signal.aborted) {
	      abortController.abort();
	    }
	    invalidateWorkflowRuns();

    if (currentConversationId) {
      try {
        const projectId = state.currentProjectId || state.uploadedFiles[0]?.projectId;
        if (projectId) {
          const { conversationService } = await import('@/services/conversationService');
          await conversationService.stopWorkflow(currentConversationId, projectId);
        }
      } catch (error) {
        console.error('Failed to stop workflow:', error);
      }
    }

    // Clear abort controller and update state
    set({
      abortController: null,
      isProcessing: false,
      isTyping: false,
      isStreamingWorkflow: false,
    });
  },

	  resetChat: (preserveTemplate = false) => {
	    const activeAbortController = get().abortController;
	    if (activeAbortController && !activeAbortController.signal.aborted) {
	      activeAbortController.abort();
	    }
	    invalidateWorkflowRuns();
	    if (!preserveTemplate) {
	      persistPendingThemeSelection(null);
	    }
    const preservedTheme = preserveTemplate ? (get().selectedTheme || get().selectedTemplate) : null;
    set({
      inputValue: "",
      isTyping: false,
      messages: initialMessages,
	      uploadedFiles: [],
	      currentConversationId: null,
	      currentProjectId: null,
	      abortController: null,
	      isProcessing: false,
	      currentWorkflowStep: null,
      priorWorkflowSteps: [],
      thinkingEvents: [],
      isStreamingWorkflow: false,
      dropdownOpen: false,
      selectedDataSource: "",
      isListening: false,
      transcript: "",
	      detectedLanguage: null,
	      hasShownInitialDashboard: false,
	      isInitialLoading: false,
	      isDashboardOpen: false,
	      isUpdatingDashboard: false,
	      isSwitchingDashboard: false,
	      previousDashboardData: null,
	      changedComponentIds: new Set<string>(),
	      editChangeSummary: null,
	      editProvenance: null,
	      analysisSteps: null,
	      isActivityOpen: false,
	      applyingComponentIds: new Set<string>(),
	      pendingEdit: null,
	      selectedDashboardId: null,
      selectedTheme: preservedTheme,
      selectedAnalysisFocusId: preservedTheme?.analysisFocusId ?? null,
      selectedTemplate: preservedTheme,
      isThemePending: preserveTemplate ? get().isThemePending : false,
      isTemplatePending: preserveTemplate ? get().isTemplatePending : false,
      // We explicitly DO NOT clear integration modal states here
      // to preserve them across navigation/reloads during picking.
    });
	  },

	  selectDashboard: async (dashboardId: string, projectId: string): Promise<unknown> => {
	    const { currentConversationId, currentProjectId, updateFile } = get();
	    if (!currentConversationId || currentProjectId !== projectId) return null;

    // Monotonic request id for cancel-and-replace: rapid clicks on different
    // dashboards must end with only the latest result applied. We stash the
    // counter on the module-scoped guard below.
    //
    // NOTE: We deliberately do NOT short-circuit when
    // `dashboardId === selectedDashboardId`. Several auto-open paths
    // (useChatStore lines ~1131, 1520, 1686) call `set({ selectedDashboardId })`
    // *before* invoking selectDashboard to fetch the data — short-circuiting
    // here would skip the fetch and leave the panel empty.
    selectDashboardSeq += 1;
    const myReq = selectDashboardSeq;

    set({ isSwitchingDashboard: true });
    try {
      const { conversationService } = await import('@/services/conversationService');
	      const response = await conversationService.getDashboardData(
	        currentConversationId,
	        projectId,
	        dashboardId
	      );

	      // A newer click superseded this one — discard.
	      if (myReq !== selectDashboardSeq) return null;
	      const current = get();
	      if (current.currentProjectId !== projectId || current.currentConversationId !== currentConversationId) return null;

	      // Phase 6: restore edit completion metadata and Activity steps when
	      // the backend attached them to this dashboard (edit responses only).
	      // Null for normal full-dashboard generation, clearing stale edit UI.
	      set({
	        editChangeSummary: response?.change_summary ?? null,
	        editProvenance: response?.computed_values ?? null,
	        analysisSteps: response?.analysis_steps ?? null,
	      });

	      if (response?.dashboard_data) {
        // Prefer theme_id baked into the dashboard JSON, then legacy template_id,
        // then localStorage mappings for dashboards generated before this split.
        const serverThemeId = response.dashboard_data.theme_id as string | undefined;
        const serverFocusId = response.dashboard_data.analysis_focus_id as string | undefined;
        const serverTemplateId = response.dashboard_data.template_id as string | undefined;
        const resolvedTheme = serverThemeId ?? getThemeIdForDashboard(dashboardId);
        const restoredTheme = resolveStoredTheme(
          resolvedTheme,
          serverFocusId,
          serverTemplateId ?? getLegacyTemplateIdForDashboard(dashboardId),
        );
        if (restoredTheme?.suggestedTheme) saveDashboardThemeId(dashboardId, restoredTheme.suggestedTheme);
        persistPendingThemeSelection(null);
        set({
          selectedDashboardId: dashboardId,
          selectedTheme: restoredTheme,
          selectedAnalysisFocusId: restoredTheme?.analysisFocusId ?? null,
          selectedTemplate: restoredTheme,
          isThemePending: false,
          isTemplatePending: false,
        });
        // Update only a file that belongs to this active dashboard context.
        const files = get().uploadedFiles;
        const targetFile =
          files.find((file) => file.projectId === projectId && file.conversationId === currentConversationId) ||
          files.find((file) => file.projectId === projectId);
        if (targetFile) {
          updateFile(targetFile.fileID, { processedData: response.dashboard_data });
        }
        return response.dashboard_data;
      }
    } catch (error) {
      console.error('Failed to load dashboard:', error);
    } finally {
      // Only the latest request can clear the flag — stale resolves must not
      // un-spin a still-running newer fetch.
      if (myReq === selectDashboardSeq) {
        set({ isSwitchingDashboard: false });
      }
    }
    return null;
  },
}));
