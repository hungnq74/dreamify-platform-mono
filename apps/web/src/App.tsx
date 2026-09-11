import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation, Navigate } from "@/lib/navigation";
import { isAppShellPath } from "@/lib/route-manifest";
import { SignedIn, SignedOut, AuthenticateWithRedirectCallback, useAuth } from "@/lib/clerk";
import ReactGA from "react-ga4";
import { useEffect } from "react";
import { useMetaPixel } from "./hooks/useMetaPixel";
import Header from "./components/homepage-section/Header";
import AboutPage from "./legacy-pages/About";
import PricingPage from "./legacy-pages/Pricing";
import ProductDataConnectorsPage from "./legacy-pages/ProductDataConnectorsPage";
import ProductWorkspaceAgentsPage from "./legacy-pages/ProductWorkspaceAgentsPage";
import FinancePage from "./legacy-pages/Finance";
import PrivacyPage from "./legacy-pages/Privacy";
import TermsPage from "./legacy-pages/Terms";
import DocsPage from "./legacy-pages/Docs";
import Index from "./legacy-pages/Index";
import NotFound from "./legacy-pages/NotFound";
import Login from "./legacy-pages/Login";
import Signup from "./legacy-pages/Signup";
import WorkspacePage from "./legacy-pages/workspace";
import WorkspaceNewsPreviewPage from "./legacy-pages/WorkspaceNewsPreviewPage";
import ProjectPage from "./legacy-pages/project";
import PreviewPage from "./legacy-pages/preview";
import FilePreviewPage from "./legacy-pages/FilePreviewPage";
import WaitlistPage from "./legacy-pages/Waitlist";
import ZaloUploadPage from "./legacy-pages/ZaloUpload";
import AdminPage from "./legacy-pages/admin";
import AdminConversationPage from "./legacy-pages/admin/conversation";
import AdminUserPage from "./legacy-pages/admin/user";
import AdminRoute from "./components/auth/AdminRoute";
import CmsListPage from "./legacy-pages/cms/CmsListPage";
import CmsEditorPage from "./legacy-pages/cms/CmsEditorPage";
import TemplateGalleryPage from "./legacy-pages/TemplateGalleryPage";
import OverallFeedbackPage from "./legacy-pages/OverallFeedbackPage";
import LandingPage from "./legacy-pages/LandingPage";
import IntegrationPage from "./legacy-pages/IntegrationPage";
import WorkspacePageSeo from "./legacy-pages/WorkspacePageSeo";
import ComparisonPage from "./legacy-pages/ComparisonPage";
import VsHub from "./legacy-pages/VsHub";
import BlogIndex from "./legacy-pages/BlogIndex";
import BlogPost from "./legacy-pages/BlogPost";
import CustomersIndex from "./legacy-pages/CustomersIndex";
import CustomerCaseStudy from "./legacy-pages/CustomerCaseStudy";
import FeaturesPage from "./legacy-pages/FeaturesPage";
import SecurityPage from "./legacy-pages/SecurityPage";
import { useChatStore } from "./chat/useChatStore";
import GA4IntegrationModal from "./components/chat/GA4IntegrationModal";
import GoogleSheetsIntegrationModal from "./components/chat/GoogleSheetsIntegrationModal";
import MetaAdsIntegrationModal from "./components/chat/MetaAdsIntegrationModal";
import TikTokIntegrationModal from "./components/chat/TikTokIntegrationModal";
import AppsFlyerIntegrationModal from "./components/chat/AppsFlyerIntegrationModal";
import StripeIntegrationModal from "./components/chat/StripeIntegrationModal";
import HubSpotIntegrationModal from "./components/chat/HubSpotIntegrationModal";
import SalesforceIntegrationModal from "./components/chat/SalesforceIntegrationModal";
import PipedriveIntegrationModal from "./components/chat/PipedriveIntegrationModal";
import SupabaseIntegrationModal from "./components/chat/SupabaseIntegrationModal";
import ShopifyIntegrationModal from "./components/chat/ShopifyIntegrationModal";
import KlaviyoIntegrationModal from "./components/chat/KlaviyoIntegrationModal";
import QuickBooksIntegrationModal from "./components/chat/QuickBooksIntegrationModal";
import ZendeskIntegrationModal from "./components/chat/ZendeskIntegrationModal";
import MixpanelIntegrationModal from "./components/chat/MixpanelIntegrationModal";
import PostHogIntegrationModal from "./components/chat/PostHogIntegrationModal";
import CustomerIOIntegrationModal from "./components/chat/CustomerIOIntegrationModal";
import GoogleSearchConsoleIntegrationModal from "./components/chat/GoogleSearchConsoleIntegrationModal";
import AmazonSellerIntegrationModal from "./components/chat/AmazonSellerIntegrationModal";
import TikTokShopSellerIntegrationModal from "./components/chat/TikTokShopSellerIntegrationModal";
import ShopeeSellerIntegrationModal from "./components/chat/ShopeeSellerIntegrationModal";
import LazadaSellerIntegrationModal from "./components/chat/LazadaSellerIntegrationModal";
import GoogleAdsIntegrationModal from "./components/chat/GoogleAdsIntegrationModal";
import FirebaseIntegrationModal from "./components/chat/FirebaseIntegrationModal";
import WarehouseIntegrationModal from "./components/chat/WarehouseIntegrationModal";
import AllConnectorsModal from "./components/chat/AllConnectorsModal";

// Module scope is safe here: App is only ever reached through the ssr:false
// dynamic import in app/legacy-route.tsx, so this client never runs on the server.
//
// Defaults are explicit rather than inherited. Every consumer today is an
// admin, blog or CMS list; run status, credits and notifications go through SSE
// and zustand, not React Query, so none of them depend on these values.
// useProjects overrides refetchOnWindowFocus — that is the one list where
// refetching on focus is genuinely wanted.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      refetchOnReconnect: true,
      retry: 1,
    },
  },
});

// Polar integration uses hosted checkout, no client-side initialization needed here

const AppContent = () => {
  const { messages } = useChatStore();
  const isStarted = messages.length > 1; // Check if user has started chatting
  const location = useLocation();
  const { isSignedIn, isLoaded } = useAuth();

  // Google Analytics pageview tracking
  useEffect(() => {
    ReactGA.send({ hitType: "pageview", page: location.pathname + location.search });
  }, [location]);

  // Meta Pixel pageview tracking
  useMetaPixel();

  const isAppPath = isAppShellPath(location.pathname);

  // The initial value is already set before first paint by the bootstrap script
  // in app/layout.tsx; this only reconciles client-side navigations, which never
  // re-run that script.
  useEffect(() => {
    document.documentElement.classList.toggle("font-marketing", !isAppPath);
  }, [isAppPath]);

  const isAuthPath = location.pathname === "/login" || location.pathname === "/signup";
  const isWorkspacePath = location.pathname.startsWith("/workspace");
  const isAdminPath = location.pathname.startsWith("/admin");
  const isHomePath = location.pathname === "/";
  const isAboutPath = location.pathname === "/about";
  const isPricingPath = location.pathname === "/pricing";
  const isProductPath = location.pathname.startsWith("/product");
  const isFinancePath = location.pathname === "/finance";
  const isPrivacyPath = location.pathname === "/privacy";
  const isTermsPath = location.pathname === "/terms";
  const isDocsPath = location.pathname === "/docs";
  const isPreviewPath = location.pathname.startsWith("/preview/");
  const isFeedbackPath = location.pathname === "/feedback";

  const isSeoMarketingPath =
    location.pathname === "/landingpage" ||
    location.pathname === "/features" ||
    location.pathname === "/security" ||
    location.pathname.startsWith("/product/data-connectors") ||
    location.pathname.startsWith("/product/workspace-agents") ||
    location.pathname === "/vs" ||
    location.pathname.startsWith("/vs/") ||
    location.pathname === "/blog" ||
    location.pathname.startsWith("/blog/") ||
    location.pathname === "/customers" ||
    location.pathname.startsWith("/customers/");

  const isAllowedSignedInPath =
    location.pathname.startsWith("/workspace") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/preview") ||
    location.pathname.startsWith("/templates") ||
    location.pathname.startsWith("/product") ||
    location.pathname === "/feedback" ||
    location.pathname === "/docs" ||
    location.pathname === "/sso-callback" ||
    location.pathname === "/cancel" ||
    location.pathname === "/success" ||
    location.pathname.startsWith("/zalo-upload") ||
    isSeoMarketingPath;

  const isPublicLandingPath =
    location.pathname === "/" ||
    location.pathname === "/about" ||
    location.pathname === "/pricing" ||
    location.pathname.startsWith("/product") ||
    location.pathname === "/finance" ||
    location.pathname === "/privacy" ||
    location.pathname === "/terms" ||
    location.pathname === "/docs" ||
    location.pathname === "/login" ||
    location.pathname === "/signup" ||
    location.pathname === "/feedback" ||
    isSeoMarketingPath;

  // Prevent public page flash while Clerk is still resolving auth state.
  if (!isLoaded && isPublicLandingPath) {
    return null;
  }

  if (isLoaded && isSignedIn && !isAllowedSignedInPath && !isPublicLandingPath) {
    return <Navigate to="/workspace" replace />;
  }

  return (
    <>
      {(isHomePath || isAboutPath || isPricingPath || isProductPath || isFinancePath || (!isStarted && !isAuthPath && !isWorkspacePath && !isAdminPath && !isPreviewPath && !isPrivacyPath && !isTermsPath && !isDocsPath && !isFeedbackPath)) && <Header />}
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/product" element={<Navigate to="/product/data-connectors" replace />} />
        <Route path="/product/data-connectors" element={<ProductDataConnectorsPage />} />
        <Route path="/product/workspace-agents" element={<ProductWorkspaceAgentsPage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        <Route path="/zalo-upload/:token" element={<ZaloUploadPage />} />
        <Route path="/workspace" element={
          <>
            <SignedIn>
              <WorkspacePage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/connectors/:connectorKey/:entityId" element={
          <>
            <SignedIn>
              <WorkspacePage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/project" element={
          <>
            <SignedIn>
              <ProjectPage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/news-preview" element={
          <>
            <SignedIn>
              <WorkspaceNewsPreviewPage />
            </SignedIn>
            <SignedOut>
              <Login />
            </SignedOut>
          </>
        } />
        <Route path="/workspace/project/preview" element={<PreviewPage />} />
        <Route path="/preview/:assetId" element={<FilePreviewPage />} />
        <Route path="/admin" element={<Navigate to="/admin/analytics" replace />} />
        <Route path="/admin/analytics" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="/admin/users" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="/admin/chat-logs" element={<AdminRoute><AdminPage /></AdminRoute>} />
        <Route path="/admin/conversation/:conversationId" element={<AdminRoute><AdminConversationPage /></AdminRoute>} />
        <Route path="/admin/users/:userId" element={<AdminRoute><AdminUserPage /></AdminRoute>} />
        <Route path="/admin/cms" element={<AdminRoute><CmsListPage /></AdminRoute>} />
        <Route path="/admin/cms/new" element={<AdminRoute><CmsEditorPage /></AdminRoute>} />
        <Route path="/admin/cms/:postId" element={<AdminRoute><CmsEditorPage /></AdminRoute>} />
        <Route path="/templates" element={<TemplateGalleryPage />} />
        <Route path="/feedback" element={<OverallFeedbackPage />} />
        <Route path="/sso-callback" element={<AuthenticateWithRedirectCallback />} />
        {/* SEO marketing routes (additive, do not modify existing routes above) */}
        <Route path="/landingpage" element={<LandingPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/security" element={<SecurityPage />} />
        <Route path="/product/data-connectors/:tool" element={<IntegrationPage />} />
        <Route path="/product/workspace-agents/:platform" element={<WorkspacePageSeo />} />
        {/* Legacy hub paths → redirect to new product hubs */}
        <Route path="/integrations" element={<Navigate to="/product/data-connectors" replace />} />
        <Route path="/integrations/:tool" element={<Navigate to="/product/data-connectors" replace />} />
        <Route path="/workspaces" element={<Navigate to="/product/workspace-agents" replace />} />
        <Route path="/workspaces/:platform" element={<Navigate to="/product/workspace-agents" replace />} />
        <Route path="/vs" element={<VsHub />} />
        <Route path="/vs/:competitor" element={<ComparisonPage />} />
        <Route path="/blog" element={<BlogIndex />} />
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/customers" element={<CustomersIndex />} />
        <Route path="/customers/:slug" element={<CustomerCaseStudy />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      <GA4IntegrationModal />
      <GoogleSheetsIntegrationModal />
      <MetaAdsIntegrationModal />
      <TikTokIntegrationModal />
      <AppsFlyerIntegrationModal />
      <StripeIntegrationModal />
      <HubSpotIntegrationModal />
      <SalesforceIntegrationModal />
      <PipedriveIntegrationModal />
      <SupabaseIntegrationModal />
      <ShopifyIntegrationModal />
      <KlaviyoIntegrationModal />
      <QuickBooksIntegrationModal />
      <ZendeskIntegrationModal />
      <MixpanelIntegrationModal />
      <PostHogIntegrationModal />
      <CustomerIOIntegrationModal />
      <GoogleSearchConsoleIntegrationModal />
      <AmazonSellerIntegrationModal />
      <TikTokShopSellerIntegrationModal />
      <ShopeeSellerIntegrationModal />
      <LazadaSellerIntegrationModal />
      <GoogleAdsIntegrationModal />
      <FirebaseIntegrationModal />
      <WarehouseIntegrationModal />
      <AllConnectorsModal />
    </>
  );
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider delayDuration={0}>
      <Toaster />
      <Sonner />
      <AppContent />
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
