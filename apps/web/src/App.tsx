import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Routes, Route, useLocation, Navigate } from "@/lib/navigation";
import { isAppShellPath } from "@/lib/route-manifest";
import { SignedIn, SignedOut, AuthenticateWithRedirectCallback, useAuth } from "@/lib/clerk";
import ReactGA from "react-ga4";
import { lazy, Suspense, useEffect } from "react";
import { useMetaPixel } from "./hooks/useMetaPixel";
import Header from "./components/homepage-section/Header";
import PricingPage from "./legacy-pages/Pricing";
import ProductDataConnectorsPage from "./legacy-pages/ProductDataConnectorsPage";
import ProductWorkspaceAgentsPage from "./legacy-pages/ProductWorkspaceAgentsPage";
import Index from "./legacy-pages/Index";
import NotFound from "./legacy-pages/NotFound";
import Login from "./legacy-pages/Login";
import Signup from "./legacy-pages/Signup";
import AdminRoute from "./components/auth/AdminRoute";
import { useChatStore } from "./chat/useChatStore";
import ConnectorModalHost from "./components/chat/ConnectorModalHost";
import { RouteFallback } from "./components/ui/RouteFallback";
import { RouteErrorBoundary } from "./components/ui/RouteErrorBoundary";

// Route components are lazy so a visitor to a marketing page does not download
// the workspace and admin bundles. The common landing targets stay eager:
// splitting those would only add a request to the critical path.
const AboutPage = lazy(() => import("./legacy-pages/About"));
const FinancePage = lazy(() => import("./legacy-pages/Finance"));
const PrivacyPage = lazy(() => import("./legacy-pages/Privacy"));
const TermsPage = lazy(() => import("./legacy-pages/Terms"));
const DocsPage = lazy(() => import("./legacy-pages/Docs"));
const WorkspacePage = lazy(() => import("./legacy-pages/workspace"));
const WorkspaceNewsPreviewPage = lazy(() => import("./legacy-pages/WorkspaceNewsPreviewPage"));
const ProjectPage = lazy(() => import("./legacy-pages/project"));
const PreviewPage = lazy(() => import("./legacy-pages/preview"));
const FilePreviewPage = lazy(() => import("./legacy-pages/FilePreviewPage"));
const WaitlistPage = lazy(() => import("./legacy-pages/Waitlist"));
const ZaloUploadPage = lazy(() => import("./legacy-pages/ZaloUpload"));
const AdminPage = lazy(() => import("./legacy-pages/admin"));
const AdminConversationPage = lazy(() => import("./legacy-pages/admin/conversation"));
const AdminUserPage = lazy(() => import("./legacy-pages/admin/user"));
const CmsListPage = lazy(() => import("./legacy-pages/cms/CmsListPage"));
const CmsEditorPage = lazy(() => import("./legacy-pages/cms/CmsEditorPage"));
const TemplateGalleryPage = lazy(() => import("./legacy-pages/TemplateGalleryPage"));
const OverallFeedbackPage = lazy(() => import("./legacy-pages/OverallFeedbackPage"));
const LandingPage = lazy(() => import("./legacy-pages/LandingPage"));
const IntegrationPage = lazy(() => import("./legacy-pages/IntegrationPage"));
const WorkspacePageSeo = lazy(() => import("./legacy-pages/WorkspacePageSeo"));
const ComparisonPage = lazy(() => import("./legacy-pages/ComparisonPage"));
const VsHub = lazy(() => import("./legacy-pages/VsHub"));
const BlogIndex = lazy(() => import("./legacy-pages/BlogIndex"));
const BlogPost = lazy(() => import("./legacy-pages/BlogPost"));
const CustomersIndex = lazy(() => import("./legacy-pages/CustomersIndex"));
const CustomerCaseStudy = lazy(() => import("./legacy-pages/CustomerCaseStudy"));
const FeaturesPage = lazy(() => import("./legacy-pages/FeaturesPage"));
const SecurityPage = lazy(() => import("./legacy-pages/SecurityPage"));

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
      {/* Routes are lazy, and the Routes shim in lib/navigation renders the
          matched element bare, so the Suspense boundary has to live here.
          Header stays outside it so the shell does not flash on navigation. */}
      <RouteErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
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
        </Suspense>
      </RouteErrorBoundary>
      <ConnectorModalHost />
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
