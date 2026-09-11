import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import WaveBackground from "@/ui/lightswind/wave-background";
import VideoBackground from '@/components/homepage-section/VideoBackground';
import { useNavigate, useParams, useSearchParams } from "@/lib/navigation";
import {
  Plus,
  Home,
  Plug,
  Clock3,
  LayoutDashboard,
  FolderOpen,
  CheckCircle2,
  Ellipsis,
  Loader2,
  SquareArrowOutUpRight,
  Sparkles,
  User as UserIcon,
  Settings,
  RefreshCw,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useUser } from "@/lib/clerk";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useLayoutStyle } from "@/hooks/useLayoutStyle";
import { useTheme } from "@/hooks/useTheme";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import WorkspaceSidebar from "@/components/project-section/WorkspaceSidebar";
import CsvPreviewPanel from "@/components/project-section/CsvPreviewPanel";
import WorkspaceNewChat from "@/components/workspace/WorkspaceNewChat";
import AccountSettings from "@/components/homepage-section/AccountSettings";
import { PlansCreditsContent, PreferencesContent } from "@/components/homepage-section/AccountCenterModal";
import { PrivacyContent, PRIVACY_METADATA, PRIVACY_TOC } from "@/legacy-pages/Privacy";
import { TermsContent, TERMS_METADATA, TERMS_TOC } from "@/legacy-pages/Terms";
import WorkspaceFiles from "@/components/workspace/WorkspaceFiles";
import ConnectorEntityDetailView from "@/components/workspace/ConnectorEntityDetailView";
import ProductNewsModal from "@/components/workspace/ProductNewsModal";
import { type WorkspaceNewsItem } from "@/components/workspace/workspaceNewsContent";
import { selectWorkspaceNewsItem } from "@/components/workspace/workspaceNewsSelection";
import OnboardingModal from "@/components/workspace/OnboardingModal";
import { useProjects } from "@/hooks/useProjects";
import { projectService, type ProjectRecord } from "@/services/projectService";
import {
  integrationService,
  type ConnectorOverviewItem,
  type ConnectorEntityDetailResponse,
  type ConnectorEntityRunItem,
} from "@/services/integrationService";
import { CONNECTORS } from "@/constants/connectors";
import { useChatStore } from "@/chat/useChatStore";
import { SlackIntegrationCard } from "@/components/integrations/SlackIntegrationCard";
import { TelegramIntegrationCard } from "@/components/integrations/TelegramIntegrationCard";
import { ZaloIntegrationCard } from "@/components/integrations/ZaloIntegrationCard";
import { WhatsAppIntegrationCard } from "@/components/integrations/WhatsAppIntegrationCard";
import { toast as sonnerToast } from "sonner";
import { formatToDisplay } from "@/utils/timestamp";
import { useSubscription } from "@/hooks/useSubscription";
import HeaderCreditBadge from "@/components/ui/HeaderCreditBadge";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { useNotificationStore } from "@/chat/useNotificationStore";
import { MetaPixel } from "@/hooks/useMetaPixel";
import FeedbackModal from "@/components/ui/FeedbackModal";
import {
  connectorCapability,
  scheduleCertifiedConnectorOpen,
  useCapabilities,
} from "@/hooks/useCapabilities";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConnectorStatus {
  connected: boolean;
  info?: string;
}

// ─── Helper: source label ─────────────────────────────────────────────────────
function inferSourceFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (t.includes("ga4") || t.includes("google analytics")) return "GA4";
  if (t.includes("google sheet") || t.includes("gsheet") || t.includes("spreadsheet")) return "Google Sheets";
  if (t.includes("google ads")) return "Google Ads";
  if (t.includes("meta ads") || t.includes("facebook ads")) return "Meta Ads";
  if (t.includes("tiktok")) return "TikTok Ads";
  if (t.includes("appsflyer")) return "AppsFlyer";
  if (t.includes("firebase")) return "Firebase";
  if (t.includes("stripe")) return "Stripe";
  if (t.includes("hubspot")) return "HubSpot";
  if (t.includes("salesforce")) return "Salesforce";
  if (t.includes("pipedrive")) return "Pipedrive";
  if (t.includes("supabase")) return "Supabase";
  if (t.includes("shopify")) return "Shopify";
  if (t.includes("klaviyo")) return "Klaviyo";
  if (t.includes("quickbooks") || t.includes("quick books")) return "QuickBooks";
  if (t.includes("zendesk")) return "Zendesk";
  if (t.includes("mixpanel")) return "Mixpanel";
  if (t.includes("posthog") || t.includes("post hog")) return "PostHog";
  if (t.includes("customer_io") || t.includes("customer.io") || t.includes("customer io")) return "Customer.io";
  if (t.includes("google_search_console") || t.includes("google search console") || t.includes("search console") || t.includes("organic search")) return "Google Search Console";
  if (t.includes("amazon_seller") || t.includes("amazon seller") || t.includes("seller central")) return "Amazon Seller";
  if (t.includes("shopee_seller") || t.includes("shopee seller") || t.includes("shopee")) return "Shopee Seller";
  if (t.includes("lazada_seller") || t.includes("lazada seller") || t.includes("lazada")) return "Lazada Seller";
  if (t.includes("tiktok_shop_seller") || t.includes("tiktok shop seller") || t.includes("tiktok shop")) return "TikTok Shop Seller";
  if (t.includes("bigquery")) return "BigQuery";
  if (t.includes("snowflake")) return "Snowflake";
  if (t.includes("databricks")) return "Databricks";
  if (t.includes("postgres") || t.includes("warehouse")) return "PostgreSQL";
  return "CSV";
}

function getSource(project: { source_type?: string | null; dashboard_title?: string | null; name?: string }): string {
  if (project.source_type) return project.source_type;
  const title = project.dashboard_title || project.name || "";
  return inferSourceFromTitle(title);
}

const SOURCE_COLORS: Record<string, string> = {
  GA4: "bg-orange-500/20 text-orange-600 dark:text-orange-300",
  "Google Sheets": "bg-green-500/20 text-green-700 dark:text-green-300",
  "Google Ads": "bg-blue-400/20 text-blue-600 dark:text-blue-300",
  "Meta Ads": "bg-blue-500/20 text-blue-700 dark:text-blue-300",
  "TikTok Ads": "bg-pink-500/20 text-pink-700 dark:text-pink-300",
  AppsFlyer: "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
  Firebase: "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300",
  Stripe: "bg-purple-500/20 text-purple-700 dark:text-purple-300",
  HubSpot: "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  Salesforce: "bg-sky-500/20 text-sky-700 dark:text-sky-300",
  Pipedrive: "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
  Supabase: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  Shopify: "bg-green-500/20 text-green-700 dark:text-green-300",
  Klaviyo: "bg-neutral-500/20 text-neutral-800 dark:text-neutral-200",
  QuickBooks: "bg-green-500/20 text-green-700 dark:text-green-300",
  Zendesk: "bg-teal-500/20 text-teal-700 dark:text-teal-300",
  Mixpanel: "bg-violet-500/20 text-violet-700 dark:text-violet-300",
  PostHog: "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "Amazon Seller": "bg-amber-500/20 text-amber-700 dark:text-amber-300",
  "Shopee Seller": "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "Lazada Seller": "bg-orange-500/20 text-orange-700 dark:text-orange-300",
  "TikTok Shop Seller": "bg-cyan-500/20 text-cyan-700 dark:text-cyan-300",
  Databricks: "bg-red-500/20 text-red-700 dark:text-red-300",
  CSV: "bg-foreground/10 text-foreground/60",
};

const CONNECTOR_CARD_DESCRIPTIONS: Record<string, string> = {
  "Meta Ads": "Sync ad campaign, ad set, and performance metrics.",
  "TikTok Ads": "Sync ad campaign, ad set, and performance metrics.",
  "Google Ads": "Sync ad campaign, ad set, and performance metrics.",
  "GA4": "Sync website and app behavior events.",
  "Google Sheets": "Use spreadsheet data as a live source for dashboards.",
  "AppsFlyer": "Sync mobile attribution and install metrics.",
  "Stripe": "Sync subscription and payment metrics.",
  "HubSpot": "Sync CRM pipeline, owners, contacts, and companies.",
  "Salesforce": "Sync Sales Cloud pipeline, leads, accounts, and activities.",
  "Pipedrive": "Sync deal stages, leads, contacts, activities, and products.",
  "Supabase": "Sync app database tables, schema, Auth, and Storage context.",
  "Firebase": "Sync app analytics and product signals.",
  "Databricks": "Sync Delta tables through Databricks SQL Warehouses.",
};

type Tab = "new-chat" | "projects" | "connectors" | "dashboards" | "files" | "settings" | "privacy" | "terms";
type SettingsSection = "plans" | "account" | "preferences";

// ─── WorkspaceDocsView ────────────────────────────────────────────────────────
// Mirrors DocsLayout visually but tracks scroll on the workspace <main> element
// rather than window, so the active-section TOC highlight works correctly.
function WorkspaceDocsView({
  children,
  metadata,
  toc,
  containerRef,
  currentTab,
  onSwitch,
}: {
  children: React.ReactNode;
  metadata: { title: string; effectiveDate: string; description: string };
  toc: { id: string; title: string }[];
  containerRef: React.RefObject<HTMLElement | null>;
  currentTab: "privacy" | "terms";
  onSwitch: (tab: "privacy" | "terms") => void;
}) {
  const [activeSection, setActiveSection] = useState("");
  const isClickScrolling = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isClickScrolling.current) return;
      const containerRect = container.getBoundingClientRect();
      const threshold = containerRect.top + 130;
      let current = "";
      for (let i = toc.length - 1; i >= 0; i--) {
        const el = document.getElementById(toc[i].id);
        if (el && el.getBoundingClientRect().top <= threshold) {
          current = toc[i].id;
          break;
        }
      }
      setActiveSection(current);
    };

    container.addEventListener("scroll", handleScroll);
    setTimeout(handleScroll, 100);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [toc, containerRef]);

  const scrollToSection = (id: string) => {
    const container = containerRef.current;
    const el = document.getElementById(id);
    if (!container || !el) return;
    isClickScrolling.current = true;
    const top = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 80;
    container.scrollTo({ top, behavior: "smooth" });
    setActiveSection(id);
    setTimeout(() => { isClickScrolling.current = false; }, 800);
  };

  return (
    <div className="grid grid-cols-4 min-h-full">
      {/* Main content — 3 cols */}
      <div className="col-span-4 lg:col-span-3 px-6 py-4 md:py-8 lg:pr-12 md:pl-12 lg:pl-16">
        {/* Tab switcher — sticky within the scrollable main container */}
        <div className="sticky top-0 z-10 flex justify-center py-3 mb-6 -mx-6 px-6">
          <div className="inline-flex items-center gap-1 bg-foreground/5 rounded-full p-1">
            {(
              [
                { key: "privacy" as const, label: "Privacy Policy" },
                { key: "terms"   as const, label: "Terms of Service" },
              ]
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onSwitch(key)}
                className={cn(
                  "px-5 py-2 rounded-full text-sm font-medium transition-all duration-200",
                  currentTab === key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="hidden md:block mb-10">
          <h1 className="text-4xl font-extrabold tracking-tight text-foreground">{metadata.title}</h1>
          <p className="mt-3 text-sm font-medium text-muted-foreground">Effective Date: {metadata.effectiveDate}</p>
          <p className="mt-6 text-lg text-muted-foreground leading-relaxed">{metadata.description}</p>
        </div>
        {/* Mobile header */}
        <div className="md:hidden mb-8">
          <h1 className="text-2xl font-bold text-foreground">{metadata.title}</h1>
          <p className="mt-2 text-xs text-muted-foreground">Effective Date: {metadata.effectiveDate}</p>
          <p className="mt-3 text-sm text-muted-foreground">{metadata.description}</p>
        </div>
        <div className="prose prose-slate dark:prose-invert max-w-none prose-headings:scroll-mt-24 space-y-10">
          {children}
        </div>
      </div>

      {/* Right TOC — 1 col */}
      <div className="hidden lg:block col-span-1 border-l border-border/50">
        <div className="sticky top-0 py-14 px-8 max-h-screen overflow-y-auto">
          <h4 className="text-sm font-semibold tracking-wider text-foreground mb-4 uppercase">On this page</h4>
          <nav className="flex flex-col space-y-2">
            {toc.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={cn(
                  "text-sm transition-colors hover:text-foreground py-1 text-left",
                  activeSection === item.id ? "font-medium text-primary" : "text-muted-foreground"
                )}
              >
                {item.title}
              </button>
            ))}
          </nav>
        </div>
      </div>
    </div>
  );
}

function UnavailableChatIntegrationCard({
  name,
  description,
  reason,
}: {
  name: string;
  description: string;
  reason?: string | null;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium text-foreground">{name}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Unavailable
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          {reason && <p className="mt-1 text-xs text-muted-foreground/80">{reason}</p>}
        </div>
        <Button size="sm" disabled className="shrink-0 text-xs">
          Unavailable
        </Button>
      </div>
    </Card>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function WorkspacePage() {
  // Notification polling belongs to the page, not to NotificationBell: the bell
  // only renders on the "new-chat" tab, so owning the interval there meant
  // switching tabs stopped notifications until the user switched back.
  useEffect(() => {
    const { startPolling, stopPolling } = useNotificationStore.getState();
    startPolling();
    return () => stopPolling();
  }, []);

  type MarketplaceTab = "all" | "analytics" | "advertising" | "sales" | "operations" | "finance" | "e-commerce";
  const routeParams = useParams<{ connectorKey?: string; entityId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as Tab | null;

  const [activeTab, setActiveTab] = useState<Tab>(
    routeParams.connectorKey && routeParams.entityId
      ? "connectors"
      : tabParam && ["new-chat", "projects", "connectors", "dashboards", "files", "settings", "privacy", "terms"].includes(tabParam)
        ? tabParam
        : "new-chat"
  );
  const [collapsed, setCollapsed] = useState(false);

  const mainRef = useRef<HTMLElement>(null);

  const sectionParam = searchParams.get("section") as SettingsSection | null;
  const detailTabParam = searchParams.get("detailTab");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    sectionParam && ["plans", "account", "preferences"].includes(sectionParam) ? sectionParam : "account"
  );

  const { toast } = useToast();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [dialog, setDialog] = useState({ open: false, mode: 'rename', itemId: '', itemTitle: '', value: '' });
  const [newsModalOpen, setNewsModalOpen] = useState(false);
  const [activeNewsItem, setActiveNewsItem] = useState<WorkspaceNewsItem | null>(null);
  const [onboardingModalOpen, setOnboardingModalOpen] = useState(false);

  const navigate = useNavigate();
  const { user } = useUser();
  const { dailyDataRunLimit } = useSubscription();
  const { capabilities } = useCapabilities();
  const [layoutStyle] = useLayoutStyle();
  const { resolvedTheme } = useTheme();

  const {
    projects,
    isLoading: projectsLoading,
    createNewProject,
    renameProject,
    deleteProject,
    openProject,
  } = useProjects();

  // ── Sync active tab with URL ─────────────────────────────────────────────────
  useEffect(() => {
    const tab = searchParams.get("tab") as Tab | null;
    if (routeParams.connectorKey && routeParams.entityId) {
      setActiveTab("connectors");
    } else if (tab && ["new-chat", "projects", "connectors", "dashboards", "files", "settings", "privacy", "terms"].includes(tab)) {
      setActiveTab(tab);
    }
    const section = searchParams.get("section") as SettingsSection | null;
    if (section && ["plans", "account", "preferences"].includes(section)) {
      setSettingsSection(section);
    }
  }, [searchParams, routeParams.connectorKey, routeParams.entityId]);

  // ── Handle Slack OAuth return ────────────────────────────────────────────────
  useEffect(() => {
    const slackResult = searchParams.get("slack");
    if (!slackResult) return;
    const workspace = searchParams.get("workspace");
    const message = searchParams.get("message");
    if (slackResult === "success") {
      sonnerToast.success(`Connected to ${workspace || "your Slack workspace"}`);
    } else if (slackResult === "error") {
      sonnerToast.error(`Slack connection failed: ${message || "Unknown error"}`);
    }
    setSearchParams((prev) => {
      prev.delete("slack");
      prev.delete("workspace");
      prev.delete("message");
      return prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const handleNewsExplore = (feature: WorkspaceNewsItem) => {
    setNewsModalOpen(false);
    if (feature.id === "templates") {
      setSearchParams({ tab: "new-chat", openTemplate: "1" });
      return;
    }
    handleTabChange(feature.targetTab as Tab);
  };

  // ── Dashboard data ───────────────────────────────────────────────────────────
  const [allProjects, setAllProjects] = useState<ProjectRecord[]>([]);
  const [dashboardsLoading, setDashboardsLoading] = useState(false);
  const [dashboardSort, setDashboardSort] = useState<"latest" | "az">("latest");
  const previewUrls: Record<string, string> = {};

  const fetchAllProjects = useCallback(async () => {
    setDashboardsLoading(true);
    try {
      const res = await projectService.listProjects();
      if (res.success) {
        setAllProjects(res.projects);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDashboardsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "dashboards") fetchAllProjects();
  }, [activeTab, fetchAllProjects]);

  const dashboardProjects = allProjects.filter((p) => p.latest_dashboard_id);
  const sortedDashboardProjects = useMemo(() => {
    return [...dashboardProjects].sort((a, b) => {
      if (dashboardSort === "az") {
        const titleA = (a.dashboard_title || a.name || "").toLowerCase();
        const titleB = (b.dashboard_title || b.name || "").toLowerCase();
        return titleA.localeCompare(titleB);
      }
      const tA = a.updated_at ? Date.parse(a.updated_at) : 0;
      const tB = b.updated_at ? Date.parse(b.updated_at) : 0;
      return tB - tA;
    });
  }, [dashboardProjects, dashboardSort]);

  // ── Connector status ─────────────────────────────────────────────────────────
  const [connectorStatus, setConnectorStatus] = useState<Record<string, ConnectorStatus>>({});
  const [connectorOverview, setConnectorOverview] = useState<ConnectorOverviewItem[]>([]);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [marketplaceTab, setMarketplaceTab] = useState<MarketplaceTab>("all");
  const [selectedConnectorCard, setSelectedConnectorCard] = useState<{
    connectorKey: string;
    connectorName: string;
    entityId: string;
    entityName: string;
  } | null>(null);
  const [detailTab, setDetailTab] = useState<"overview" | "data-table">(
    detailTabParam === "data-table" ? "data-table" : "overview"
  );
  const [connectorDetail, setConnectorDetail] = useState<ConnectorEntityDetailResponse | null>(null);
  const [connectorHistory, setConnectorHistory] = useState<ConnectorEntityRunItem[]>([]);
  const [activeAssetId, setActiveAssetId] = useState<string | null>(null);
  const [selectedHistoryRunId, setSelectedHistoryRunId] = useState<string | null>(null);
  const relatedProjectPreviewUrls: Record<string, string> = {};
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(true);
  const [refreshModalOpen, setRefreshModalOpen] = useState(false);
  const [feedbackModal, setFeedbackModal] = useState<{ open: boolean; category: string; placeholder: string }>({ open: false, category: "", placeholder: "" });
  const [refreshDatePreset, setRefreshDatePreset] = useState("last_30d");
  const [refreshStartDate, setRefreshStartDate] = useState("");
  const [refreshEndDate, setRefreshEndDate] = useState("");
  const [refreshCampaignIds, setRefreshCampaignIds] = useState("");
  const [refreshAdsetIds, setRefreshAdsetIds] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [refreshingData, setRefreshingData] = useState(false);
  const connectorKey = selectedConnectorCard?.connectorKey || "";
  const isGoogleSheetsConnector = connectorKey === "google_sheets";
  const isMetaAdsConnector = connectorKey === "meta_ads";

  const {
    setGA4ModalOpen,
    setGoogleSheetsModalOpen,
    setMetaAdsModalOpen,
    setTikTokModalOpen,
    setAppsFlyerModalOpen,
    setStripeModalOpen,
    setHubSpotModalOpen,
    setSalesforceModalOpen,
    setPipedriveModalOpen,
    setSupabaseModalOpen,
    setShopifyModalOpen,
    setKlaviyoModalOpen,
    setQuickBooksModalOpen,
    setZendeskModalOpen,
    setMixpanelModalOpen,
    setPostHogModalOpen,
    setCustomerIOModalOpen,
    setGoogleSearchConsoleModalOpen,
    setAmazonSellerModalOpen,
    setTikTokShopSellerModalOpen,
    setShopeeSellerModalOpen,
    setLazadaSellerModalOpen,
    setGoogleAdsModalOpen,
    setFirebaseModalOpen,
    setWarehouseModalOpen,
  } = useChatStore();

  const handleIntegrationClick = (connectorName: string) => {
    const normalizedName = connectorName === "Meta"
      ? "Meta Ads"
      : connectorName === "TikTok"
        ? "TikTok Ads"
        : connectorName;
    const connector = CONNECTORS.find((item) => item.name === normalizedName);
    const availability = connectorCapability(capabilities, connector?.connectorKey);
    if (!availability.enabled) {
      toast({
        title: `${normalizedName} is unavailable`,
        description: availability.reason ?? "This connector has not passed its hosted smoke test.",
      });
      return;
    }
    // Track Lead event for connector integration attempts
    MetaPixel.track('Lead', {
      content_name: connectorName,
      content_category: 'connector_integration',
    });

    if (connectorName === 'GA4') {
      setGA4ModalOpen(true);
    } else if (connectorName === 'Google Sheets') {
      setGoogleSheetsModalOpen(true);
    } else if (connectorName === 'Meta' || connectorName === 'Meta Ads') {
      setMetaAdsModalOpen(true);
    } else if (connectorName === 'TikTok' || connectorName === 'TikTok Ads') {
      setTikTokModalOpen(true);
    } else if (connectorName === 'AppsFlyer') {
      setAppsFlyerModalOpen(true);
    } else if (connectorName === 'Stripe') {
      setStripeModalOpen(true);
    } else if (connectorName === 'HubSpot') {
      setHubSpotModalOpen(true);
    } else if (connectorName === 'Salesforce') {
      setSalesforceModalOpen(true);
    } else if (connectorName === 'Pipedrive') {
      setPipedriveModalOpen(true);
    } else if (connectorName === 'Supabase') {
      setSupabaseModalOpen(true);
    } else if (connectorName === 'Shopify') {
      setShopifyModalOpen(true);
    } else if (connectorName === 'Klaviyo') {
      setKlaviyoModalOpen(true);
    } else if (connectorName === 'QuickBooks') {
      setQuickBooksModalOpen(true);
    } else if (connectorName === 'Zendesk') {
      setZendeskModalOpen(true);
    } else if (connectorName === 'Mixpanel') {
      setMixpanelModalOpen(true);
    } else if (connectorName === 'PostHog') {
      setPostHogModalOpen(true);
    } else if (connectorName === 'Customer.io') {
      setCustomerIOModalOpen(true);
    } else if (connectorName === 'Google Search Console') {
      setGoogleSearchConsoleModalOpen(true);
    } else if (connectorName === 'Amazon Seller') {
      setAmazonSellerModalOpen(true);
    } else if (connectorName === 'TikTok Shop Seller') {
      setTikTokShopSellerModalOpen(true);
    } else if (connectorName === 'Shopee Seller') {
      setShopeeSellerModalOpen(true);
    } else if (connectorName === 'Lazada Seller') {
      setLazadaSellerModalOpen(true);
    } else if (connectorName === 'Google Ads') {
      setGoogleAdsModalOpen(true);
    } else if (connectorName === 'Firebase') {
      setFirebaseModalOpen(true);
    } else if (connectorName === 'PostgreSQL') {
      setWarehouseModalOpen(true, "postgres");
    } else if (connectorName === 'BigQuery') {
      setWarehouseModalOpen(true, "bigquery");
    } else if (connectorName === 'Snowflake') {
      setWarehouseModalOpen(true, "snowflake");
    } else if (connectorName === 'Databricks') {
      setWarehouseModalOpen(true, "databricks");
    }
  };

  const fetchConnectorStatuses = useCallback(async () => {
    const hasCertifiedConnector = CONNECTORS.some(
      (connector) => connectorCapability(capabilities, connector.connectorKey).enabled,
    );
    if (!hasCertifiedConnector) {
      setConnectorStatus({});
      setConnectorOverview([]);
      setConnectorsLoading(false);
      return;
    }
    setConnectorsLoading(true);
    try {
      const results: Record<string, ConnectorStatus> = {};

      const metaStatusPromise = integrationService.getMetaConnectionStatus();
      const tiktokStatusPromise = integrationService.getTikTokConnectionStatus();
      const googleTokenPromise = integrationService.getGoogleOAuthToken();
      const appsflyerStatusPromise = integrationService.getAppsFlyerStatus();
      const stripeStatusPromise = integrationService.getStripeStatus();
      const hubspotStatusPromise = integrationService.getHubSpotStatus();
      const salesforceStatusPromise = integrationService.getSalesforceStatus();
      const pipedriveStatusPromise = integrationService.getPipedriveStatus();
      const supabaseStatusPromise = integrationService.getSupabaseStatus();
      const shopifyStatusPromise = integrationService.getShopifyStatus();
      const klaviyoStatusPromise = integrationService.getKlaviyoStatus();
      const quickBooksStatusPromise = integrationService.getQuickBooksStatus();
      const zendeskStatusPromise = integrationService.getZendeskStatus();
      const mixpanelStatusPromise = integrationService.getMixpanelStatus();
      const postHogStatusPromise = integrationService.getPostHogStatus();
      const customerIOStatusPromise = integrationService.getCustomerIOStatus();
      const googleSearchConsoleStatusPromise = integrationService.getGoogleSearchConsoleStatus();
      const amazonSellerStatusPromise = integrationService.getAmazonSellerStatus();
      const tiktokShopStatusPromise = integrationService.getTikTokShopSellerStatus();
      const shopeeSellerStatusPromise = integrationService.getShopeeSellerStatus();
      const lazadaSellerStatusPromise = integrationService.getLazadaSellerStatus();
      const overviewPromise = integrationService.fetchConnectorsOverview();

      const metaStatus = await metaStatusPromise;
      if (metaStatus.connected) {
        try {
          const metaAccounts = await integrationService.fetchMetaAdAccounts();
          const firstMetaAccount = metaAccounts.ad_accounts?.[0];
          results["Meta Ads"] = {
            connected: true,
            info: firstMetaAccount ? `Account: ${firstMetaAccount.name}` : "Account: Meta Ads",
          };
        } catch (_) {
          results["Meta Ads"] = { connected: true, info: "Account: Meta Ads" };
        }
      } else {
        results["Meta Ads"] = { connected: false };
      }

      const tiktokStatus = await tiktokStatusPromise;
      if (tiktokStatus.connected) {
        try {
          const ttAccounts = await integrationService.fetchTikTokAdAccounts();
          const firstTTAccount = ttAccounts.ad_accounts?.[0];
          results["TikTok Ads"] = {
            connected: true,
            info: firstTTAccount ? `Account: ${firstTTAccount.name}` : "Account: TikTok Ads",
          };
        } catch (_) {
          results["TikTok Ads"] = { connected: true, info: "Account: TikTok Ads" };
        }
      } else {
        results["TikTok Ads"] = { connected: false };
      }

      const googleToken = await googleTokenPromise;
      if (googleToken.success && googleToken.token) {
        // Use clerk's user external accounts to get the connected Google account email
        const googleEmail = user?.externalAccounts?.find((a) => (a.provider as string).includes("google"))?.emailAddress;

        let fallbackAccountInfo = "Account: Google Analytics";
        if (!googleEmail) {
          try {
            const ga4Res = await integrationService.fetchGoogleAnalyticsProperties();
            const firstAccount = ga4Res.accounts?.[0];
            if (firstAccount) {
              fallbackAccountInfo = `Account: ${firstAccount.account_name}`;
            }
          } catch {
            // Keep the generic fallback when GA properties cannot be loaded.
          }
        }

        const info = googleEmail ? `Account: ${googleEmail}` : fallbackAccountInfo;
        results["GA4"] = { connected: true, info };
        results["Google Sheets"] = { connected: true, info };
        results["Google Ads"] = { connected: true, info };
        results["Firebase"] = { connected: true, info };
      } else {
        results["GA4"] = { connected: false };
        results["Google Sheets"] = { connected: false };
        results["Google Ads"] = { connected: false };
        results["Firebase"] = { connected: false };
      }

      const appsflyerStatus = await appsflyerStatusPromise;
      results["AppsFlyer"] = appsflyerStatus.connected
        ? { connected: true, info: "Account: AppsFlyer" }
        : { connected: false };

      const stripeStatus = await stripeStatusPromise;
      results["Stripe"] = stripeStatus.connected
        ? { connected: true, info: "Account: Stripe" }
        : { connected: false };

      const hubspotStatus = await hubspotStatusPromise;
      results["HubSpot"] = hubspotStatus.connected
        ? { connected: true, info: `Account: ${hubspotStatus.portal_domain || hubspotStatus.account_name || "HubSpot"}` }
        : { connected: false };

      const salesforceStatus = await salesforceStatusPromise;
      results["Salesforce"] = salesforceStatus.connected
        ? { connected: true, info: `Account: ${salesforceStatus.account_name || salesforceStatus.instance_domain || "Salesforce"}` }
        : { connected: false };

      const pipedriveStatus = await pipedriveStatusPromise;
      results["Pipedrive"] = pipedriveStatus.connected
        ? { connected: true, info: `Account: ${pipedriveStatus.account_name || pipedriveStatus.company_domain || "Pipedrive"}` }
        : { connected: false };

      const supabaseStatus = await supabaseStatusPromise;
      results["Supabase"] = supabaseStatus.connected
        ? { connected: true, info: `${supabaseStatus.connection_count || 0} connection${supabaseStatus.connection_count === 1 ? "" : "s"}` }
        : { connected: false };

      const shopifyStatus = await shopifyStatusPromise;
      results["Shopify"] = shopifyStatus.connected
        ? { connected: true, info: `Account: ${shopifyStatus.shop_domain || shopifyStatus.shop_name || "Shopify"}` }
        : { connected: false };

      const klaviyoStatus = await klaviyoStatusPromise;
      results["Klaviyo"] = klaviyoStatus.connected
        ? { connected: true, info: `Account: ${klaviyoStatus.account_name || klaviyoStatus.account_id || "Klaviyo"}` }
        : { connected: false };

      const quickBooksStatus = await quickBooksStatusPromise;
      results["QuickBooks"] = quickBooksStatus.connected
        ? { connected: true, info: `Account: ${quickBooksStatus.company_name || quickBooksStatus.realm_id || "QuickBooks"}` }
        : { connected: false };

      const zendeskStatus = await zendeskStatusPromise;
      results["Zendesk"] = zendeskStatus.connected
        ? { connected: true, info: `Account: ${zendeskStatus.account_name || zendeskStatus.subdomain || "Zendesk"}` }
        : { connected: false };

      const mixpanelStatus = await mixpanelStatusPromise;
      results["Mixpanel"] = mixpanelStatus.connected
        ? { connected: true, info: `Project: ${mixpanelStatus.account_name || mixpanelStatus.project_id || "Mixpanel"}` }
        : { connected: false };

      const postHogStatus = await postHogStatusPromise;
      results["PostHog"] = postHogStatus.connected
        ? { connected: true, info: `Project: ${postHogStatus.account_name || postHogStatus.project_id || "PostHog"}` }
        : { connected: false };

      const customerIOStatus = await customerIOStatusPromise;
      results["Customer.io"] = customerIOStatus.connected
        ? { connected: true, info: `Workspace: ${customerIOStatus.account_name || customerIOStatus.workspace_id || "Customer.io"}` }
        : { connected: false };

      const googleSearchConsoleStatus = await googleSearchConsoleStatusPromise;
      results["Google Search Console"] = googleSearchConsoleStatus.connected
        ? { connected: true, info: googleSearchConsoleStatus.account_name || `${googleSearchConsoleStatus.site_count || 0} propert${googleSearchConsoleStatus.site_count === 1 ? "y" : "ies"}` }
        : { connected: false };

      const amazonSellerStatus = await amazonSellerStatusPromise;
      results["Amazon Seller"] = amazonSellerStatus.connected
        ? { connected: true, info: `Account: ${amazonSellerStatus.seller_name || amazonSellerStatus.seller_id || "Amazon Seller"}` }
        : { connected: false };

      const tiktokShopStatus = await tiktokShopStatusPromise;
      results["TikTok Shop Seller"] = tiktokShopStatus.connected
        ? { connected: true, info: `Account: ${tiktokShopStatus.account_name || tiktokShopStatus.account_id || "TikTok Shop Seller"}` }
        : { connected: false };

      const shopeeSellerStatus = await shopeeSellerStatusPromise;
      results["Shopee Seller"] = shopeeSellerStatus.connected
        ? { connected: true, info: `Account: ${shopeeSellerStatus.account_name || shopeeSellerStatus.account_id || "Shopee Seller"}` }
        : { connected: false };

      const lazadaSellerStatus = await lazadaSellerStatusPromise;
      results["Lazada Seller"] = lazadaSellerStatus.connected
        ? { connected: true, info: `Account: ${lazadaSellerStatus.account_name || lazadaSellerStatus.account_id || "Lazada Seller"}` }
        : { connected: false };

      const overview = await overviewPromise;
      if (overview.success) {
        setConnectorOverview(overview.connectors);
        const postgres = overview.connectors.find((connector) => connector.connector_key === "postgres");
        const bigquery = overview.connectors.find((connector) => connector.connector_key === "bigquery");
        const snowflake = overview.connectors.find((connector) => connector.connector_key === "snowflake");
        const databricks = overview.connectors.find((connector) => connector.connector_key === "databricks");
        const hubspot = overview.connectors.find((connector) => connector.connector_key === "hubspot");
        const salesforce = overview.connectors.find((connector) => connector.connector_key === "salesforce");
        const pipedrive = overview.connectors.find((connector) => connector.connector_key === "pipedrive");
        const supabase = overview.connectors.find((connector) => connector.connector_key === "supabase");
        const shopify = overview.connectors.find((connector) => connector.connector_key === "shopify");
        const klaviyo = overview.connectors.find((connector) => connector.connector_key === "klaviyo");
        const quickBooks = overview.connectors.find((connector) => connector.connector_key === "quickbooks");
        const zendesk = overview.connectors.find((connector) => connector.connector_key === "zendesk");
        const mixpanel = overview.connectors.find((connector) => connector.connector_key === "mixpanel");
        const posthog = overview.connectors.find((connector) => connector.connector_key === "posthog");
        const customerIO = overview.connectors.find((connector) => connector.connector_key === "customer_io");
        const googleSearchConsole = overview.connectors.find((connector) => connector.connector_key === "google_search_console");
        const amazonSeller = overview.connectors.find((connector) => connector.connector_key === "amazon_seller");
        const tiktokShopSeller = overview.connectors.find((connector) => connector.connector_key === "tiktok_shop_seller");
        const shopeeSeller = overview.connectors.find((connector) => connector.connector_key === "shopee_seller");
        const lazadaSeller = overview.connectors.find((connector) => connector.connector_key === "lazada_seller");
        if (postgres?.connected) {
          const tableCount = postgres.selected_entities?.length || 0;
          results["PostgreSQL"] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : "Account: PostgreSQL",
          };
        } else {
          results["PostgreSQL"] = { connected: false };
        }
        if (bigquery?.connected) {
          const tableCount = bigquery.selected_entities?.length || 0;
          results["BigQuery"] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : "Account: BigQuery",
          };
        } else {
          results["BigQuery"] = { connected: false };
        }
        if (snowflake?.connected) {
          const tableCount = snowflake.selected_entities?.length || 0;
          results["Snowflake"] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : "Account: Snowflake",
          };
        } else {
          results["Snowflake"] = { connected: false };
        }
        if (databricks?.connected) {
          const tableCount = databricks.selected_entities?.length || 0;
          results["Databricks"] = {
            connected: true,
            info: tableCount > 0 ? `${tableCount} table${tableCount === 1 ? "" : "s"}` : "Account: Databricks",
          };
        } else {
          results["Databricks"] = { connected: false };
        }
        if (hubspot?.connected) {
          const reportCount = hubspot.selected_entities?.length || 0;
          results["HubSpot"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["HubSpot"]?.info || "Account: HubSpot",
          };
        }
        if (salesforce?.connected) {
          const reportCount = salesforce.selected_entities?.length || 0;
          results["Salesforce"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Salesforce"]?.info || "Account: Salesforce",
          };
        }
        if (pipedrive?.connected) {
          const reportCount = pipedrive.selected_entities?.length || 0;
          results["Pipedrive"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Pipedrive"]?.info || "Account: Pipedrive",
          };
        }
        if (supabase?.connected) {
          const entityCount = supabase.selected_entities?.length || 0;
          results["Supabase"] = {
            connected: true,
            info: entityCount > 0 ? `${entityCount} item${entityCount === 1 ? "" : "s"}` : results["Supabase"]?.info || "Account: Supabase",
          };
        }
        if (shopify?.connected) {
          const reportCount = shopify.selected_entities?.length || 0;
          results["Shopify"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Shopify"]?.info || "Account: Shopify",
          };
        }
        if (klaviyo?.connected) {
          const reportCount = klaviyo.selected_entities?.length || 0;
          results["Klaviyo"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Klaviyo"]?.info || "Account: Klaviyo",
          };
        }
        if (quickBooks?.connected) {
          const reportCount = quickBooks.selected_entities?.length || 0;
          results["QuickBooks"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["QuickBooks"]?.info || "Account: QuickBooks",
          };
        }
        if (zendesk?.connected) {
          const reportCount = zendesk.selected_entities?.length || 0;
          results["Zendesk"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Zendesk"]?.info || "Account: Zendesk",
          };
        }
        if (mixpanel?.connected) {
          const reportCount = mixpanel.selected_entities?.length || 0;
          results["Mixpanel"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Mixpanel"]?.info || "Project: Mixpanel",
          };
        }
        if (posthog?.connected) {
          const reportCount = posthog.selected_entities?.length || 0;
          results["PostHog"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["PostHog"]?.info || "Project: PostHog",
          };
        }
        if (customerIO?.connected) {
          const reportCount = customerIO.selected_entities?.length || 0;
          results["Customer.io"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Customer.io"]?.info || "Workspace: Customer.io",
          };
        }
        if (googleSearchConsole?.connected) {
          const reportCount = googleSearchConsole.selected_entities?.length || 0;
          results["Google Search Console"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Google Search Console"]?.info || "Google Search Console",
          };
        }
        if (amazonSeller?.connected) {
          const reportCount = amazonSeller.selected_entities?.length || 0;
          results["Amazon Seller"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Amazon Seller"]?.info || "Account: Amazon Seller",
          };
        }
        if (tiktokShopSeller?.connected) {
          const reportCount = tiktokShopSeller.selected_entities?.length || 0;
          results["TikTok Shop Seller"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["TikTok Shop Seller"]?.info || "Account: TikTok Shop Seller",
          };
        }
        if (shopeeSeller?.connected) {
          const reportCount = shopeeSeller.selected_entities?.length || 0;
          results["Shopee Seller"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Shopee Seller"]?.info || "Account: Shopee Seller",
          };
        }
        if (lazadaSeller?.connected) {
          const reportCount = lazadaSeller.selected_entities?.length || 0;
          results["Lazada Seller"] = {
            connected: true,
            info: reportCount > 0 ? `${reportCount} report${reportCount === 1 ? "" : "s"}` : results["Lazada Seller"]?.info || "Account: Lazada Seller",
          };
        }
      } else {
        setConnectorOverview([]);
        results["PostgreSQL"] = { connected: false };
        results["BigQuery"] = { connected: false };
        results["Snowflake"] = { connected: false };
        results["Databricks"] = { connected: false };
        results["Supabase"] = { connected: false };
        results["Shopify"] = { connected: false };
        results["Klaviyo"] = { connected: false };
        results["QuickBooks"] = { connected: false };
        results["Zendesk"] = { connected: false };
        results["Mixpanel"] = { connected: false };
        results["PostHog"] = { connected: false };
        results["Amazon Seller"] = { connected: false };
        results["TikTok Shop Seller"] = { connected: false };
        results["Shopee Seller"] = { connected: false };
        results["Lazada Seller"] = { connected: false };
      }
      setConnectorStatus(results);
    } catch (e) {
      console.error("Failed to fetch connector statuses:", e);
      setConnectorOverview([]);
    } finally {
      setConnectorsLoading(false);
    }
  }, [capabilities, user]);

  useEffect(() => {
    if (activeTab === "connectors") fetchConnectorStatuses();
  }, [activeTab, fetchConnectorStatuses]);

  useEffect(() => {
    const handleConnectorSynced = () => {
      if (activeTab !== "connectors") return;
      fetchConnectorStatuses();
    };
    window.addEventListener("dreamify:connector-synced", handleConnectorSynced);
    return () => window.removeEventListener("dreamify:connector-synced", handleConnectorSynced);
  }, [activeTab, fetchConnectorStatuses]);

  useEffect(() => {
    if (!user?.id) return;

    const onboardingStorageKey = `dreamify:workspace:onboarding:seen:${user.id}`;
    const hasSeenOnboarding = localStorage.getItem(onboardingStorageKey) === "true";
    if (!hasSeenOnboarding) {
      setOnboardingModalOpen(true);
      return;
    }

    const nextNewsItem = selectWorkspaceNewsItem({ userId: user.id });
    if (!nextNewsItem) return;

    setActiveNewsItem(nextNewsItem);
    setNewsModalOpen(true);
  }, [user?.id]);

  const handleDismissOnboarding = useCallback(() => {
    if (!user?.id) return;
    const onboardingStorageKey = `dreamify:workspace:onboarding:seen:${user.id}`;
    localStorage.setItem(onboardingStorageKey, "true");
    setOnboardingModalOpen(false);

    // Track CompleteRegistration when user completes onboarding
    MetaPixel.track('CompleteRegistration', {
      content_name: 'Dreamify Onboarding',
      status: true,
    });
  }, [user?.id]);

  const displayName = user?.fullName || user?.firstName || "My Workspace";
  const myConnectedCards = useMemo(
    () =>
      connectorOverview
        .filter((item) => item.connected)
        .flatMap((item) =>
          (item.selected_entities ?? []).map((entity) => ({
            connectorKey: item.connector_key,
            connectorName: item.display_name,
            entityId: entity.id,
            entityName: entity.name,
          }))
        ),
    [connectorOverview]
  );
  const marketplaceConnectors = useMemo(() => {
    if (marketplaceTab === "all") {
      return [...CONNECTORS].sort((a, b) => {
        const aAvailable = Boolean(a.isActive);
        const bAvailable = Boolean(b.isActive);
        if (aAvailable === bAvailable) return a.name.localeCompare(b.name);
        return aAvailable ? -1 : 1;
      });
    }
    const tabCategoryMap: Record<Exclude<MarketplaceTab, "all">, string> = {
      analytics: "Analytics Platform",
      advertising: "Advertising Platform",
      sales: "Sales & CRM",
      operations: "Operations & Database",
      finance: "Payment & Finance",
      "e-commerce": "E-commerce",
    };
    return CONNECTORS.filter((connector) => connector.category === tabCategoryMap[marketplaceTab as Exclude<MarketplaceTab, "all">]);
  }, [marketplaceTab]);

  const updateWorkspaceParams = useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        Object.entries(updates).forEach(([key, value]) => {
          if (value == null || value === "") {
            next.delete(key);
            return;
          }
          next.set(key, value);
        });
        return next;
      });
    },
    [setSearchParams]
  );

  const loadConnectorDetail = useCallback(async (connectorKey: string, entityId: string) => {
    setDetailLoading(true);
    try {
      const [detailRes, historyRes] = await Promise.all([
        integrationService.fetchConnectorEntityDetail(connectorKey, entityId),
        integrationService.fetchConnectorEntityHistory(connectorKey, entityId, 30),
      ]);
      setConnectorDetail(detailRes.success ? detailRes : null);
      const normalizedRuns = historyRes.success ? [...(historyRes.runs || [])] : [];
      if (normalizedRuns.length === 0 && detailRes.success && detailRes.latest_asset?.asset_id) {
        normalizedRuns.push({
          run_id: `asset-${detailRes.latest_asset.asset_id}`,
          status: "success",
          completed_at: detailRes.latest_asset.created_at,
          rows_fetched: detailRes.latest_asset.row_count,
          columns_fetched: detailRes.latest_asset.column_count,
          asset_id: detailRes.latest_asset.asset_id,
          asset_filename: detailRes.latest_asset.filename,
          config_snapshot: {
            entity_id: entityId,
            entity_name: detailRes.entity?.name || entityId,
            rows: detailRes.latest_asset.row_count,
            columns: detailRes.latest_asset.column_count,
            size_bytes: detailRes.latest_asset.size_bytes,
          },
        });
      }
      setConnectorHistory(normalizedRuns);
      const latestAssetId = detailRes.latest_asset?.asset_id || normalizedRuns.find((run) => !!run.asset_id)?.asset_id || null;
      setActiveAssetId(latestAssetId || null);
      const selectedRun = historyRes.success
        ? normalizedRuns.find((run) => run.asset_id === latestAssetId) || normalizedRuns[0]
        : null;
      setSelectedHistoryRunId(selectedRun?.run_id || null);
    } catch (error) {
      console.error("Failed to load connector detail:", error);
      setConnectorDetail(null);
      setConnectorHistory([]);
      setActiveAssetId(null);
      setSelectedHistoryRunId(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const handleSelectConnectorCard = useCallback(
    async (
      card: { connectorKey: string; connectorName: string; entityId: string; entityName: string },
      options?: { syncRoute?: boolean; tab?: "overview" | "data-table" }
    ) => {
      const detailTabToUse = options?.tab ?? "overview";
      setSelectedConnectorCard(card);
      setDetailTab(detailTabToUse);
      if (options?.syncRoute !== false) {
        const encodedConnectorKey = encodeURIComponent(card.connectorKey);
        const encodedEntityId = encodeURIComponent(card.entityId);
        navigate(`/workspace/connectors/${encodedConnectorKey}/${encodedEntityId}?detailTab=${detailTabToUse}`);
      }
      await loadConnectorDetail(card.connectorKey, card.entityId);
    },
    [loadConnectorDetail, navigate]
  );

  const handleDetailTabChange = useCallback(
    (tab: "overview" | "data-table") => {
      setDetailTab(tab);
      if (!selectedConnectorCard) return;
      updateWorkspaceParams({ detailTab: tab });
    },
    [selectedConnectorCard, updateWorkspaceParams]
  );

  useEffect(() => {
    const schedule = connectorDetail?.latest_schedule as Record<string, unknown> | undefined;
    if (!schedule) return;
    setRefreshDatePreset(String(schedule.date_range_preset || "last_30d"));
    const cfg = (schedule.connector_config || {}) as Record<string, unknown>;
    const campaignIds = Array.isArray(cfg.campaign_ids) ? cfg.campaign_ids.join(",") : "";
    const adsetIds = Array.isArray(cfg.adset_ids) ? cfg.adset_ids.join(",") : "";
    setRefreshCampaignIds(campaignIds);
    setRefreshAdsetIds(adsetIds);
    setRefreshStartDate("");
    setRefreshEndDate("");
  }, [connectorDetail?.latest_schedule]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    const connectorKeyParam = routeParams.connectorKey ?? searchParams.get("connectorKey");
    const entityIdParam = routeParams.entityId ?? searchParams.get("entityId");
    const detailTabQuery = searchParams.get("detailTab");
    const initialDetailTab = detailTabQuery === "data-table" ? "data-table" : "overview";
    const isConnectorRoute = Boolean(routeParams.connectorKey && routeParams.entityId);
    if (!isConnectorRoute && tab !== "connectors") return;
    if (!connectorKeyParam || !entityIdParam) return;
    const matchedCard = myConnectedCards.find(
      (card) => card.connectorKey === connectorKeyParam && card.entityId === entityIdParam
    );
    if (!matchedCard) return;
    if (
      selectedConnectorCard?.connectorKey === matchedCard.connectorKey &&
      selectedConnectorCard?.entityId === matchedCard.entityId
    ) {
      return;
    }
    handleSelectConnectorCard(matchedCard, { syncRoute: false, tab: initialDetailTab });
  }, [
    searchParams,
    routeParams.connectorKey,
    routeParams.entityId,
    myConnectedCards,
    selectedConnectorCard,
    handleSelectConnectorCard,
  ]);

  const handleRefreshConnectorData = useCallback(async (payload?: {
    date_preset?: string;
    start_date?: string;
    end_date?: string;
    campaign_ids?: string[];
    adset_ids?: string[];
  }) => {
    if (!selectedConnectorCard) return;
    setRefreshingData(true);
    try {
      const result = await integrationService.refreshConnectorEntity(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId,
        payload
      );
      if (!result.success) {
        throw new Error(result.error || "Failed to refresh data");
      }
      await loadConnectorDetail(selectedConnectorCard.connectorKey, selectedConnectorCard.entityId);
      await fetchConnectorStatuses();
      setRefreshModalOpen(false);
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to refresh connector data");
    } finally {
      setRefreshingData(false);
    }
  }, [selectedConnectorCard, loadConnectorDetail, fetchConnectorStatuses]);

  const handleSubmitRefreshModal = useCallback(async () => {
    const payload: {
      date_preset?: string;
      start_date?: string;
      end_date?: string;
      campaign_ids?: string[];
      adset_ids?: string[];
    } = {};
    if (!isGoogleSheetsConnector) {
      if (refreshDatePreset === "custom") {
        if (refreshStartDate) payload.start_date = refreshStartDate;
        if (refreshEndDate) payload.end_date = refreshEndDate;
      } else {
        payload.date_preset = refreshDatePreset;
      }
    }
    if (isMetaAdsConnector && refreshCampaignIds.trim()) {
      payload.campaign_ids = refreshCampaignIds.split(",").map((v) => v.trim()).filter(Boolean);
    }
    if (isMetaAdsConnector && refreshAdsetIds.trim()) {
      payload.adset_ids = refreshAdsetIds.split(",").map((v) => v.trim()).filter(Boolean);
    }
    await handleRefreshConnectorData(payload);
  }, [
    refreshDatePreset,
    refreshStartDate,
    refreshEndDate,
    refreshCampaignIds,
    refreshAdsetIds,
    isGoogleSheetsConnector,
    isMetaAdsConnector,
    handleRefreshConnectorData,
  ]);

  const handleAddToNewProject = useCallback(async (assetId?: string, syncVersionName?: string) => {
    if (!selectedConnectorCard) return;
    try {
      const projectName = `${selectedConnectorCard.entityName} Project`;
      const defaultPrompt = "Analyze this data and build a dashboard.";
      const result = await integrationService.addConnectorEntityToNewProject(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId,
        { project_name: projectName, prompt: defaultPrompt, asset_id: assetId }
      );
      if (!result.success || !result.project?.project_id || !result.asset?.asset_id) {
        throw new Error(result.error || "Failed to create project from connector");
      }
      const pendingFile = {
        fileID: result.asset.asset_id,
        filename: result.asset.filename,
        size: result.asset.size_bytes || 0,
        ext: result.asset.extension || "csv",
        status: "uploaded" as const,
        projectId: result.project.project_id,
        sourceType: selectedConnectorCard.connectorName,
        accountName: selectedConnectorCard.connectorName,
        propertyName: selectedConnectorCard.entityName,
        syncVersionName,
        rowCount: result.asset.row_count,
        columnCount: result.asset.column_count,
      };
      useChatStore.getState().setPendingFilesForNewChat([pendingFile]);
      navigate("/workspace?tab=new-chat");
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to add data to new project");
    }
  }, [selectedConnectorCard, navigate]);

  const handleDeleteConnectorEntity = useCallback(async () => {
    if (!selectedConnectorCard) return;
    try {
      const result = await integrationService.deleteConnectorEntity(
        selectedConnectorCard.connectorKey,
        selectedConnectorCard.entityId
      );
      if (!result.success) throw new Error(result.error || "Failed to delete connector entity");
      sonnerToast.success("Connector entity deleted");
      setSelectedConnectorCard(null);
      navigate("/workspace?tab=connectors");
      await fetchConnectorStatuses();
    } catch (error) {
      sonnerToast.error(error instanceof Error ? error.message : "Failed to delete connector entity");
    }
  }, [selectedConnectorCard, fetchConnectorStatuses, navigate]);

  const selectedHistoryRun =
    connectorHistory.find((run) => run.run_id === selectedHistoryRunId) ||
    connectorHistory.find((run) => run.asset_id === activeAssetId) ||
    null;

  // ── Post-redirect: auto-open connector modal after OAuth consent ────────────
  useEffect(() => {
    const connectorParam = searchParams.get('connector');
    if (!connectorParam) return;

    const CONNECTOR_MODAL_MAP: Partial<Record<string, (open: boolean) => void>> = {
      'ga4': setGA4ModalOpen,
      'google-sheets': setGoogleSheetsModalOpen,
      'google-ads': setGoogleAdsModalOpen,
      'firebase': setFirebaseModalOpen,
      'hubspot': setHubSpotModalOpen,
      'salesforce': setSalesforceModalOpen,
      'pipedrive': setPipedriveModalOpen,
      'supabase': setSupabaseModalOpen,
      'shopify': setShopifyModalOpen,
      'klaviyo': setKlaviyoModalOpen,
      'quickbooks': setQuickBooksModalOpen,
      'zendesk': setZendeskModalOpen,
      'mixpanel': setMixpanelModalOpen,
      'posthog': setPostHogModalOpen,
      'customer-io': setCustomerIOModalOpen,
      'google-search-console': setGoogleSearchConsoleModalOpen,
      'amazon-seller': setAmazonSellerModalOpen,
      'tiktok-shop-seller': setTikTokShopSellerModalOpen,
      'shopee-seller': setShopeeSellerModalOpen,
      'lazada-seller': setLazadaSellerModalOpen,
      'postgres': (open: boolean) => setWarehouseModalOpen(open, 'postgres'),
      'bigquery': (open: boolean) => setWarehouseModalOpen(open, 'bigquery'),
      'snowflake': (open: boolean) => setWarehouseModalOpen(open, 'snowflake'),
      'databricks': (open: boolean) => setWarehouseModalOpen(open, 'databricks'),
    };

    const openModal = CONNECTOR_MODAL_MAP[connectorParam];
    const { availability, scheduled } = scheduleCertifiedConnectorOpen(
      capabilities,
      connectorParam,
      openModal,
    );
    if (openModal && !scheduled) {
      sonnerToast.error(availability.reason ?? "This connector is unavailable");
    }

    // Clean up the query param from URL
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('connector');
    const remaining = newParams.toString();
    const newUrl = `${window.location.pathname}${remaining ? '?' + remaining : ''}`;
    window.history.replaceState({}, '', newUrl);
  }, [capabilities, searchParams, setGA4ModalOpen, setGoogleSheetsModalOpen, setGoogleAdsModalOpen, setFirebaseModalOpen, setHubSpotModalOpen, setSalesforceModalOpen, setPipedriveModalOpen, setSupabaseModalOpen, setShopifyModalOpen, setKlaviyoModalOpen, setQuickBooksModalOpen, setZendeskModalOpen, setMixpanelModalOpen, setPostHogModalOpen, setCustomerIOModalOpen, setGoogleSearchConsoleModalOpen, setAmazonSellerModalOpen, setTikTokShopSellerModalOpen, setShopeeSellerModalOpen, setLazadaSellerModalOpen, setWarehouseModalOpen]);

  const isAesthetic = layoutStyle === "aesthetic" && activeTab === "new-chat";
  const showWorkspaceHeaderActions = activeTab === "new-chat";

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={cn("h-screen h-[100dvh] overflow-hidden flex relative", isAesthetic ? "bg-transparent" : "bg-muted")}>

      {/* ── Aesthetic background (root level, behind everything) ── */}
      {isAesthetic && (
        <>
          {resolvedTheme === "dark" ? (
            <WaveBackground className="absolute inset-0 z-0" backdropBlurAmount="none" />
          ) : (
            <VideoBackground className="absolute inset-0 z-0" />
          )}
          <div className={`absolute inset-0 z-[1] ${resolvedTheme === "dark" ? "bg-black/60" : "bg-white/20"}`} />
        </>
      )}

      <div className="hidden md:flex relative z-[10]">
        <WorkspaceSidebar
          collapsed={collapsed}
          onCollapsedChange={setCollapsed}
          activeTab={activeTab}
          projects={projects}
          projectsLoading={projectsLoading}
          onOpenProject={openProject}
          onRenameProject={renameProject}
          onDeleteProject={deleteProject}
          aesthetic={isAesthetic}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MAIN CONTENT
      ══════════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 relative z-[2]">
        {showWorkspaceHeaderActions && (
          <div className="hidden md:flex items-center absolute top-4 right-6 z-50">
            <HeaderCreditBadge
              dailyRunLimit={dailyDataRunLimit}
            />
            <NotificationBell />
          </div>
        )}

        {/* Mobile Navigation Tabs */}
        <div className="md:hidden flex items-center justify-around border-b border-border/30 bg-muted/95 sticky top-0 z-40 backdrop-blur-sm">
          <button
            onClick={() => navigate('/workspace?tab=new-chat')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'new-chat' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            New Project
          </button>
          <button
            onClick={() => navigate('/workspace?tab=projects')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'projects' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Projects
          </button>
          <button
            onClick={() => navigate('/workspace?tab=connectors')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'connectors' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Connectors
          </button>
          <button
            onClick={() => navigate('/workspace?tab=dashboards')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'dashboards' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Dashboards
          </button>
          <button
            onClick={() => navigate('/workspace?tab=files')}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'files' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
          >
            Files
          </button>
        </div>

        {/* Scrollable content */}
        <main
          ref={mainRef}
          className={cn(
            "flex-1 overflow-y-auto",
            (activeTab === "privacy" || activeTab === "terms" || isAesthetic) ? "" : "p-6"
          )}
        >

          {/* ════ NEW CHAT TAB ════ */}
          {activeTab === "new-chat" && (
            <WorkspaceNewChat />
          )}

        {/* ════ PROJECTS TAB ════ */}
        {activeTab === "projects" && (
          <>
            {/* Desktop Grid View */}
            <div className="hidden md:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {/* Create new card */}
              <Card
                onClick={() => createNewProject()}
                className="border-dashed border-2 border-border/40 hover:border-primary/50 cursor-pointer transition-all group"
                style={{ minHeight: "200px" }}
              >
                <CardContent className="flex flex-col items-center justify-center h-full gap-2 py-10">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-border/50 group-hover:border-primary/50 flex items-center justify-center transition-colors">
                    <Plus className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <p className="text-sm text-muted-foreground group-hover:text-foreground/70 transition-colors">New Project</p>
                </CardContent>
              </Card>

              {projectsLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                  <Card key={i} className="animate-pulse" style={{ minHeight: "200px" }}>
                    <div className="w-full aspect-video bg-muted/50 rounded-t-lg" />
                    <CardContent className="p-4">
                      <div className="h-4 bg-muted rounded mb-2 w-3/4" />
                      <div className="h-3 bg-muted/50 rounded w-1/2" />
                    </CardContent>
                  </Card>
                ))
                : projects.map((project) => (
                  <Card
                    key={project.id}
                    onClick={() => openProject(project.id)}
                    className="overflow-hidden hover:border-primary/40 cursor-pointer transition-all group"
                    style={{ minHeight: "200px" }}
                  >
                    <div className="w-full aspect-video overflow-hidden bg-gradient-to-br from-primary/10 to-primary/5 flex items-center justify-center">
                      <FolderOpen className="w-10 h-10 text-primary/30 group-hover:text-primary/50 transition-colors" />
                    </div>
                    <CardContent className="p-4">
                      <h3 className="font-medium text-sm mb-1 truncate">{project.title}</h3>
                      {project.updated_at && (
                        <p className="text-xs text-muted-foreground">
                          {formatToDisplay(project.updated_at, { format: "date" })}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
            </div>

            {/* Mobile List View */}
            <div className="md:hidden flex flex-col gap-2">
              {projectsLoading ? (
                <div className="text-center text-muted-foreground text-sm py-4">Loading your projects...</div>
              ) : projects.length === 0 ? (
                <div className="text-center text-muted-foreground text-sm py-4 bg-muted/30 rounded-lg border border-border/40">No projects yet</div>
              ) : (
                projects.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/30 hover:bg-muted transition-colors"
                    onClick={() => openProject(item.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0 pr-10">
                      <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center flex-shrink-0">
                        <FolderOpen className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
                        {item.updated_at && <span className="text-xs text-muted-foreground">{formatToDisplay(item.updated_at, { format: "date" })}</span>}
                      </div>
                    </div>

                    <button
                      className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center w-8 h-8 rounded-full hover:bg-muted transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId((prev) => (prev === item.id ? null : item.id));
                      }}
                    >
                      <Ellipsis className="w-5 h-5 text-muted-foreground" />
                    </button>

                    {openMenuId === item.id && (
                      <div className="absolute right-4 top-10 w-32 bg-popover border border-border rounded-md shadow-xl py-1 z-50">
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-foreground/80 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDialog({ open: true, mode: 'rename', itemId: item.id, itemTitle: item.title, value: item.title });
                            setOpenMenuId(null);
                          }}
                        >
                          Rename
                        </button>
                        <button
                          className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-muted"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDialog({ open: true, mode: 'delete', itemId: item.id, itemTitle: item.title, value: '' });
                            setOpenMenuId(null);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {/* ════ CONNECTORS TAB ════ */}
        {activeTab === "connectors" && (
          <div>
            {selectedConnectorCard ? (
              <>
                <ConnectorEntityDetailView
                  selectedConnectorCard={selectedConnectorCard}
                  detailTab={detailTab}
                  setDetailTab={handleDetailTabChange}
                  onBack={() => {
                    setSelectedConnectorCard(null);
                    navigate("/workspace?tab=connectors");
                  }}
                  onAddToNewProject={handleAddToNewProject}
                  onAddSelectedHistoryToNewProject={(assetId, syncVersionName) => handleAddToNewProject(assetId, syncVersionName)}
                  onDeleteEntity={handleDeleteConnectorEntity}
                  detailLoading={detailLoading}
                  connectorDetail={connectorDetail}
                  relatedProjectPreviewUrls={relatedProjectPreviewUrls}
                  activeAssetId={activeAssetId}
                  refreshingData={refreshingData}
                  onOpenRefreshModal={() => setRefreshModalOpen(true)}
                  selectedHistoryRun={selectedHistoryRun}
                  connectorHistory={connectorHistory}
                  selectedHistoryRunId={selectedHistoryRunId}
                  setSelectedHistoryRunId={setSelectedHistoryRunId}
                  setActiveAssetId={setActiveAssetId}
                  isHistoryExpanded={isHistoryExpanded}
                  setIsHistoryExpanded={setIsHistoryExpanded}
                  refreshModalOpen={refreshModalOpen}
                  setRefreshModalOpen={setRefreshModalOpen}
                  refreshDatePreset={refreshDatePreset}
                  setRefreshDatePreset={setRefreshDatePreset}
                  refreshStartDate={refreshStartDate}
                  setRefreshStartDate={setRefreshStartDate}
                  refreshEndDate={refreshEndDate}
                  setRefreshEndDate={setRefreshEndDate}
                  refreshCampaignIds={refreshCampaignIds}
                  setRefreshCampaignIds={setRefreshCampaignIds}
                  refreshAdsetIds={refreshAdsetIds}
                  setRefreshAdsetIds={setRefreshAdsetIds}
                  onSubmitRefreshModal={handleSubmitRefreshModal}
                  onOpenRelatedProject={(projectId, dashboardId) => {
                    const dashboardQuery = dashboardId ? `&dashboardId=${encodeURIComponent(dashboardId)}` : "";
                    navigate(`/workspace/project?projectId=${projectId}${dashboardQuery}`);
                  }}
                  projects={projects}
                />
              </>
            ) : (
              <>
                <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm ring-1 ring-foreground/5">
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h2 className="text-xl font-bold tracking-tight text-foreground dark:text-white">Connectors</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Connect your data sources to build dashboards faster.</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                        <Plug className="h-3.5 w-3.5" />
                        {myConnectedCards.length} connected
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Active Data Connectors</h3>
                  <p className="text-sm text-muted-foreground mb-3">Connected sources powering your dashboards</p>
                  {myConnectedCards.length === 0 ? (
                    <Card className="p-4 border-dashed border-border/60 bg-muted/20">
                      <p className="text-sm text-muted-foreground">Connect a source and select data to see it here.</p>
                    </Card>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {myConnectedCards.map((card) => {
                        const connectorMeta = CONNECTORS.find((connector) => connector.name === card.connectorName);
                        return (
                          <Card
                            key={`${card.connectorKey}-${card.entityId}`}
                            onClick={() => handleSelectConnectorCard(card)}
                            className="p-4 hover:border-primary/40 cursor-pointer transition-all"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${connectorMeta?.iconBg ?? 'bg-muted dark:bg-white/5'}`}>
                                  {connectorMeta?.icon ? (
                                    <img
                                      src={connectorMeta.icon}
                                      alt={card.connectorName}
                                      className={`w-7 h-7 object-contain ${card.connectorName === "TikTok Ads" ? "scale-125" : ""}`}
                                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                    />
                                  ) : (
                                    <Plug className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h3 className="font-medium text-sm text-foreground truncate">{card.entityName}</h3>
                                  <span className="text-xs text-muted-foreground">{card.connectorName}</span>
                                </div>
                              </div>
                              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-1" />
                            </div>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </div>
                {/* ── Integrations (chat platforms) ── */}
                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-3">Integrations</h3>
                  <div className="flex flex-col gap-3">
                    {connectorCapability(capabilities, "slack").enabled ? (
                      <SlackIntegrationCard />
                    ) : (
                      <UnavailableChatIntegrationCard
                        name="Slack"
                        description="Bring Dreamify into your Slack workspace"
                        reason={connectorCapability(capabilities, "slack").reason}
                      />
                    )}
                    {connectorCapability(capabilities, "telegram").enabled ? (
                      <TelegramIntegrationCard />
                    ) : (
                      <UnavailableChatIntegrationCard
                        name="Telegram"
                        description="Use Dreamify in Telegram chats and groups"
                        reason={connectorCapability(capabilities, "telegram").reason}
                      />
                    )}
                    {connectorCapability(capabilities, "zalo").enabled ? (
                      <ZaloIntegrationCard />
                    ) : (
                      <UnavailableChatIntegrationCard
                        name="Zalo"
                        description="Use Dreamify in Zalo direct messages"
                        reason={connectorCapability(capabilities, "zalo").reason}
                      />
                    )}
                    {connectorCapability(capabilities, "whatsapp").enabled ? (
                      <WhatsAppIntegrationCard />
                    ) : (
                      <UnavailableChatIntegrationCard
                        name="WhatsApp"
                        description="Use Dreamify in WhatsApp direct messages"
                        reason={connectorCapability(capabilities, "whatsapp").reason}
                      />
                    )}
                  </div>
                </div>
                <Separator className="mb-6" />

                <div className="mb-8">
                  <h3 className="text-sm font-semibold text-foreground mb-1">Add a Connector</h3>
                  <p className="text-sm text-muted-foreground mb-3">Browse and connect data sources</p>
                  <div className="flex flex-wrap items-center gap-2 mb-4">
                    {[
                      { key: "all", label: "All" },
                      { key: "analytics", label: "Analytics" },
                      { key: "advertising", label: "Advertising" },
                      { key: "sales", label: "Sales & CRM" },
                      { key: "operations", label: "Operations" },
                      { key: "finance", label: "Finance" },
                      { key: "e-commerce", label: "E-Commerce" },
                    ].map((tab) => (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setMarketplaceTab(tab.key as MarketplaceTab)}
                        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                          marketplaceTab === tab.key
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {connectorsLoading && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mb-4 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/80 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm"
                  >
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span>Checking connector status...</span>
                  </div>
                )}

                <TooltipProvider delayDuration={150}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {marketplaceConnectors.map((connector) => {
                      const status = connectorStatus[connector.name];
                      const availability = connectorCapability(capabilities, connector.connectorKey);
                      const overviewMatch = connectorOverview.find(
                        (item) => item.display_name === connector.name
                      );
                      const isConnected = Boolean(status?.connected || overviewMatch?.connected);
                      const isSoon = !availability.enabled;
                      const isStatusPending = connectorsLoading && availability.enabled && !status && !overviewMatch;
                      const connectorDescription =
                        CONNECTOR_CARD_DESCRIPTIONS[connector.name] || "Connect this data source to build dashboards faster.";

                      return (
                        <Card
                          key={connector.name}
                          onClick={() => !isSoon && handleIntegrationClick(connector.name)}
                          className={`p-4 h-[92px] transition-all ${isSoon ? "opacity-55" : "hover:border-primary/40 cursor-pointer"}`}
                        >
                          <div className="flex items-center justify-between gap-3 h-full">
                            <div className="flex min-w-0 flex-1 items-center gap-3">
                              <div className={`w-10 h-10 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 ${connector.iconBg ?? 'bg-muted dark:bg-white/5'} ${isSoon ? "grayscale" : ""}`}>
                                <img
                                  src={connector.icon}
                                  alt={connector.name}
                                  className={`w-7 h-7 object-contain ${connector.name === 'TikTok Ads' ? 'scale-125' : ''}`}
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                />
                              </div>
                              <div className="min-w-0 flex-1">
                                <h3 className="font-medium text-sm text-foreground truncate">{connector.name}</h3>
                                <span className="text-xs text-muted-foreground block truncate">{connectorDescription}</span>
                              </div>
                            </div>
                            {isSoon ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    aria-label="Unavailable"
                                    title={availability.reason ?? "Connector unavailable"}
                                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border/60"
                                    role="img"
                                    tabIndex={0}
                                  >
                                    <Clock3 className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>{availability.reason ?? "Unavailable in this deployment"}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                {isStatusPending ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        aria-label="Checking status"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary"
                                        role="status"
                                        tabIndex={0}
                                      >
                                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>Checking status</TooltipContent>
                                  </Tooltip>
                                ) : isConnected ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        aria-label="Connected"
                                        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500"
                                        role="img"
                                        tabIndex={0}
                                      >
                                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>{status?.info || "Connected"}</TooltipContent>
                                  </Tooltip>
                                ) : null}
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleIntegrationClick(connector.name); }}
                                  className="w-fit shrink-0 px-4 py-1.5 button-outline text-xs rounded-md inline-flex items-center justify-center"
                                >
                                  Connect
                                </button>
                              </div>
                            )}
                          </div>
                        </Card>
                      );
                    })}
                    {/* Request connector card */}
                    <Card
                      onClick={() => setFeedbackModal({ open: true, category: "Request Connector & Workspace", placeholder: "What connector would you like to see? (e.g. specific platform, database, API...)" })}
                      className="p-4 h-[92px] transition-all hover:border-primary/40 cursor-pointer border-dashed"
                    >
                      <div className="flex items-center justify-between h-full">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
                            <Plus className="w-5 h-5 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-medium text-sm text-foreground truncate">Request a Connector</h3>
                            <span className="text-xs text-muted-foreground block truncate">Tell us what you need, we build it for you</span>
                          </div>
                        </div>
                      </div>
                    </Card>
                  </div>
                </TooltipProvider>
              </>
            )}
          </div>
        )}


          {/* ════ FILES TAB ════ */}
          {activeTab === "files" && (
            <WorkspaceFiles />
          )}

          {/* ════ SETTINGS TAB ════ */}
          {activeTab === "settings" && (
            <div className="flex gap-0 min-h-full">
              {/* Settings sidebar */}
              <aside className="w-52 flex-shrink-0 border-r border-border/40 pr-4 self-start sticky top-0">
                <nav className="space-y-0.5">
                  {(
                    [
                      { key: "plans"       as SettingsSection, label: "Preview limits", Icon: Sparkles  },
                      { key: "account"     as SettingsSection, label: "Manage Account",  Icon: UserIcon  },
                      { key: "preferences" as SettingsSection, label: "Preferences",     Icon: Settings  },
                    ] as { key: SettingsSection; label: string; Icon: React.ElementType }[]
                  ).map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => { setSettingsSection(key); setSearchParams({ tab: "settings", section: key }); }}
                      className={cn(
                        "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors text-left",
                        settingsSection === key
                          ? "bg-foreground/10 text-foreground"
                          : "text-foreground/70 hover:bg-foreground/5 hover:text-foreground"
                      )}
                    >
                      <Icon className={`w-4 h-4 flex-shrink-0 ${settingsSection === key ? "text-primary" : "text-muted-foreground"}`} />
                      <span>{label}</span>
                    </button>
                  ))}
                </nav>
              </aside>

              {/* Settings content — fills remaining width */}
              <div className="flex-1 min-w-0 pl-6">
                {settingsSection === "plans"       && <PlansCreditsContent />}
                {settingsSection === "account"     && <AccountSettings />}
                {settingsSection === "preferences" && <PreferencesContent />}
              </div>
            </div>
          )}

          {/* ════ PRIVACY POLICY TAB ════ */}
          {activeTab === "privacy" && (
            <WorkspaceDocsView
              metadata={PRIVACY_METADATA}
              toc={PRIVACY_TOC}
              containerRef={mainRef}
              currentTab="privacy"
              onSwitch={(tab) => { setActiveTab(tab); setSearchParams({ tab }); }}
            >
              <PrivacyContent />
            </WorkspaceDocsView>
          )}

          {/* ════ TERMS OF SERVICE TAB ════ */}
          {activeTab === "terms" && (
            <WorkspaceDocsView
              metadata={TERMS_METADATA}
              toc={TERMS_TOC}
              containerRef={mainRef}
              currentTab="terms"
              onSwitch={(tab) => { setActiveTab(tab); setSearchParams({ tab }); }}
            >
              <TermsContent />
            </WorkspaceDocsView>
          )}

          {/* ════ MY DASHBOARDS TAB ════ */}
          {activeTab === "dashboards" && (
            <div>
              <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm ring-1 ring-foreground/5">
                <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight text-foreground dark:text-white">My Dashboards</h2>
                    <p className="mt-1 text-sm text-muted-foreground">Browse every dashboard you have created across your projects.</p>
                  </div>
                  {!dashboardsLoading && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary">
                        <LayoutDashboard className="h-3.5 w-3.5" />
                        {dashboardProjects.length} dashboard{dashboardProjects.length !== 1 ? "s" : ""}
                      </span>
                      <div className="inline-flex rounded-full border border-border/60 bg-background/70 p-0.5">
                        {[
                          { key: "latest", label: "Latest" },
                          { key: "az", label: "A-Z" },
                        ].map((option) => (
                          <button
                            key={option.key}
                            type="button"
                            onClick={() => setDashboardSort(option.key as "latest" | "az")}
                            className={cn(
                              "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                              dashboardSort === option.key
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:bg-primary/10 hover:text-primary"
                            )}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              {dashboardsLoading ? (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Card key={i} className="animate-pulse overflow-hidden rounded-2xl border-border/60 bg-card/80">
                      <div className="aspect-[4/5] w-full bg-muted/50" />
                      <CardContent className="p-4">
                        <div className="h-4 bg-muted rounded mb-2 w-3/4" />
                        <div className="h-3 bg-muted/50 rounded w-1/2" />
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : dashboardProjects.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <LayoutDashboard className="w-12 h-12 text-muted-foreground/30 mb-4" />
                  <h3 className="text-muted-foreground font-medium mb-2">No dashboards yet</h3>
                  <p className="text-sm text-muted-foreground mb-6 max-w-xs">
                    Upload a CSV, connect a data source, and let Dreamify build your first dashboard.
                  </p>
                  <button
                    onClick={() => createNewProject()}
                    className="button-gradient h-9 px-4 rounded-md text-sm text-white flex items-center gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    New Project
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {sortedDashboardProjects.map((project) => {
                    const title = project.dashboard_title || project.name || "Untitled Dashboard";
                    const source = getSource(project);
                    const previewUrl = previewUrls[project.id];
                    const createdAt = project.updated_at
                      ? formatToDisplay(project.updated_at, { format: "full" })
                      : null;

                    return (
                      <Card
                        key={project.id}
                        onClick={() => navigate(`/workspace/project?projectId=${project.id}`)}
                        className="group cursor-pointer overflow-hidden rounded-2xl border-border/60 bg-card/85 shadow-sm ring-1 ring-foreground/5 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/45 hover:shadow-lg hover:shadow-primary/10"
                      >
                        {/* 4:5 preview area */}
                        <div className="relative aspect-[4/5] w-full overflow-hidden bg-gradient-to-br from-primary/10 via-blue-500/8 to-cyan-500/5">
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={`${title} preview`}
                              className="absolute inset-0 h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-[1.03]"
                              onError={(e) => {
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const fallback = img.parentElement?.querySelector('[data-fallback]') as HTMLElement | null;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}

                      {/* SVG Fallback — fills the full 16:9 frame */}
                      <div
                        data-fallback
                        className="absolute inset-0 items-center justify-center"
                        style={{ display: previewUrl ? 'none' : 'flex' }}
                      >
                        <svg
                          viewBox="0 0 160 90"
                          className="w-full h-full"
                          preserveAspectRatio="xMidYMid slice"
                          aria-hidden="true"
                        >
                          <defs>
                            <linearGradient id={`dbG1-${project.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(221 83% 70%)" stopOpacity="0.9" />
                              <stop offset="100%" stopColor="hsl(260 80% 60%)" stopOpacity="0.5" />
                            </linearGradient>
                            <linearGradient id={`dbG2-${project.id}`} x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(175 80% 60%)" stopOpacity="0.8" />
                              <stop offset="100%" stopColor="hsl(221 83% 60%)" stopOpacity="0.4" />
                            </linearGradient>
                          </defs>
                          {/* Trend line */}
                          <path d="M16 55 L38 42 L62 50 L84 28 L108 38 L140 18" stroke="hsl(142 76% 60%)" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
                          {/* Bars */}
                          <rect x="16" y="62" width="16" height="20" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.5" />
                          <rect x="40" y="54" width="16" height="28" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.75" />
                          <rect x="64" y="66" width="16" height="16" rx="3" fill={`url(#dbG2-${project.id})`} opacity="0.55" />
                          <rect x="88" y="58" width="16" height="24" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.85" />
                          <rect x="112" y="70" width="16" height="12" rx="3" fill={`url(#dbG2-${project.id})`} opacity="0.6" />
                          <rect x="136" y="50" width="14" height="32" rx="3" fill={`url(#dbG1-${project.id})`} opacity="0.7" />
                          {/* Peak dot */}
                          <circle cx="84" cy="28" r="4" fill="hsl(142 76% 60%)" opacity="0.9" />
                          <circle cx="84" cy="28" r="7" fill="hsl(142 76% 60%)" opacity="0.2" />
                        </svg>
                      </div>

                      {/* Hover overlay */}
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/55 via-transparent to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
                    </div>

                    {/* Card info */}
                    <CardContent className="p-4">
                      <h3 className="mb-2 truncate text-sm font-semibold text-foreground">{title}</h3>
                      <div className="flex items-center justify-between gap-2">
                        <p className="inline-flex min-w-0 items-center rounded-full bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
                          <span className="truncate">Source: {source}</span>
                        </p>
                        {createdAt && (
                          <p className="flex-shrink-0 whitespace-nowrap text-xs text-muted-foreground">{createdAt}</p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </div>
    )
  }
        </main >
      </div >

    {/* Rename / Delete Dialog */ }
  {
    dialog.open && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setDialog({ ...dialog, open: false })} />
        <div className="relative z-[201] w-11/12 max-w-[320px] rounded-xl border border-border bg-muted shadow-2xl p-4">
          {dialog.mode === 'rename' ? (
            <div>
              <div className="text-base font-medium text-foreground mb-3">Rename project</div>
              <input
                value={dialog.value}
                onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                className="w-full px-3 py-2 text-sm rounded-md bg-background border border-border outline-none focus:border-primary/50 text-foreground"
                autoFocus
              />
              <div className="mt-4 flex justify-end gap-2">
                <button
                  className="px-4 py-2 text-sm rounded-md bg-transparent text-foreground/70 hover:bg-muted/80"
                  onClick={() => setDialog({ ...dialog, open: false })}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-sm rounded-md button-gradient text-white"
                  onClick={() => {
                    const v = dialog.value.trim();
                    if (v && dialog.itemId) {
                      renameProject(dialog.itemId, v);
                      toast({
                        title: "Project renamed",
                        description: `"${dialog.itemTitle}" → "${v}"`,
                      });
                    }
                    setDialog({ ...dialog, open: false });
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-base font-medium text-foreground mb-2">Delete Project</div>
              <div className="text-sm text-foreground/70 mb-4">Are you sure you want to delete "{dialog.itemTitle}"? This cannot be undone.</div>
              <div className="flex justify-end gap-2">
                <button
                  className="px-4 py-2 text-sm rounded-md bg-transparent text-foreground/70 hover:bg-muted/80"
                  onClick={() => setDialog({ ...dialog, open: false })}
                >
                  Cancel
                </button>
                <button
                  className="px-4 py-2 text-sm rounded-md bg-red-600/80 hover:bg-red-600 text-white"
                  onClick={() => {
                    if (dialog.itemId) {
                      deleteProject(dialog.itemId);
                      toast({
                        title: "Project deleted",
                        description: `"${dialog.itemTitle}" was removed`,
                        variant: "destructive",
                      });
                    }
                    setDialog({ ...dialog, open: false });
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }
    <ProductNewsModal
      open={newsModalOpen}
      feature={activeNewsItem}
      onClose={() => setNewsModalOpen(false)}
      onExplore={handleNewsExplore}
    />
    <OnboardingModal
      open={onboardingModalOpen}
      onDismiss={handleDismissOnboarding}
    />
    <FeedbackModal
      open={feedbackModal.open}
      onClose={() => setFeedbackModal((prev) => ({ ...prev, open: false }))}
      category={feedbackModal.category}
      placeholder={feedbackModal.placeholder}
    />
    </div >
  );
}
