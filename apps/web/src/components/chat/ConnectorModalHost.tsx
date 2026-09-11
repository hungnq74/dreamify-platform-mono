import { lazy, Suspense } from "react";

import { useChatStore } from "@/chat/useChatStore";

/**
 * Mounts exactly one connector modal — the open one — instead of all 25.
 *
 * Previously every modal was rendered unconditionally in App.tsx, outside
 * <Routes>, so all of them mounted on every route including the marketing
 * pages. Their data fetches were guarded by isOpen, but three costs were not:
 *
 *   - 16 of them open a BroadcastChannel and a window 'message' listener in a
 *     mount effect with empty deps, used to receive the OAuth popup callback.
 *   - AllConnectorsModal calls useCapabilities(), which refreshes on mount and
 *     issued GET /api/v1/capabilities with cache:"no-store" on every route.
 *   - Each one subscribes to the whole chat store with no selector, so every
 *     streaming token re-rendered all of them.
 *
 * Each modal is also a lazy import, so ~14,800 lines of connector UI leave the
 * initial bundle and arrive only when a connector is actually opened.
 *
 * The store still owns the individual isXModalOpen booleans and the modals
 * still read their own flag, so this is additive: no modal and no caller
 * changed. Collapsing those 25 booleans into one activeConnectorModal field is
 * a separate, mechanical follow-up.
 */

type ModalId =
  | "ga4"
  | "google_sheets"
  | "meta_ads"
  | "tiktok_ads"
  | "appsflyer"
  | "stripe"
  | "hubspot"
  | "salesforce"
  | "pipedrive"
  | "supabase"
  | "shopify"
  | "klaviyo"
  | "quickbooks"
  | "zendesk"
  | "mixpanel"
  | "posthog"
  | "customer_io"
  | "google_search_console"
  | "amazon_seller"
  | "tiktok_shop_seller"
  | "shopee_seller"
  | "lazada_seller"
  | "google_ads"
  | "firebase"
  | "warehouse"
  | "all_connectors";

type ChatState = ReturnType<typeof useChatStore.getState>;

/**
 * Order matters only for the degenerate case of two flags being true at once,
 * which the openers never produce. Kept as an array so the lookup is a single
 * pass and the flag/modal pairing is readable in one place.
 */
const MODAL_FLAGS: ReadonlyArray<readonly [keyof ChatState, ModalId]> = [
  ["isGA4ModalOpen", "ga4"],
  ["isGoogleSheetsModalOpen", "google_sheets"],
  ["isMetaAdsModalOpen", "meta_ads"],
  ["isTikTokModalOpen", "tiktok_ads"],
  ["isAppsFlyerModalOpen", "appsflyer"],
  ["isStripeModalOpen", "stripe"],
  ["isHubSpotModalOpen", "hubspot"],
  ["isSalesforceModalOpen", "salesforce"],
  ["isPipedriveModalOpen", "pipedrive"],
  ["isSupabaseModalOpen", "supabase"],
  ["isShopifyModalOpen", "shopify"],
  ["isKlaviyoModalOpen", "klaviyo"],
  ["isQuickBooksModalOpen", "quickbooks"],
  ["isZendeskModalOpen", "zendesk"],
  ["isMixpanelModalOpen", "mixpanel"],
  ["isPostHogModalOpen", "posthog"],
  ["isCustomerIOModalOpen", "customer_io"],
  ["isGoogleSearchConsoleModalOpen", "google_search_console"],
  ["isAmazonSellerModalOpen", "amazon_seller"],
  ["isTikTokShopSellerModalOpen", "tiktok_shop_seller"],
  ["isShopeeSellerModalOpen", "shopee_seller"],
  ["isLazadaSellerModalOpen", "lazada_seller"],
  ["isGoogleAdsModalOpen", "google_ads"],
  ["isFirebaseModalOpen", "firebase"],
  ["isWarehouseModalOpen", "warehouse"],
  ["isAllConnectorsModalOpen", "all_connectors"],
] as const;

const REGISTRY: Record<ModalId, React.LazyExoticComponent<React.ComponentType>> = {
  ga4: lazy(() => import("./GA4IntegrationModal")),
  google_sheets: lazy(() => import("./GoogleSheetsIntegrationModal")),
  meta_ads: lazy(() => import("./MetaAdsIntegrationModal")),
  tiktok_ads: lazy(() => import("./TikTokIntegrationModal")),
  appsflyer: lazy(() => import("./AppsFlyerIntegrationModal")),
  stripe: lazy(() => import("./StripeIntegrationModal")),
  hubspot: lazy(() => import("./HubSpotIntegrationModal")),
  salesforce: lazy(() => import("./SalesforceIntegrationModal")),
  pipedrive: lazy(() => import("./PipedriveIntegrationModal")),
  supabase: lazy(() => import("./SupabaseIntegrationModal")),
  shopify: lazy(() => import("./ShopifyIntegrationModal")),
  klaviyo: lazy(() => import("./KlaviyoIntegrationModal")),
  quickbooks: lazy(() => import("./QuickBooksIntegrationModal")),
  zendesk: lazy(() => import("./ZendeskIntegrationModal")),
  mixpanel: lazy(() => import("./MixpanelIntegrationModal")),
  posthog: lazy(() => import("./PostHogIntegrationModal")),
  customer_io: lazy(() => import("./CustomerIOIntegrationModal")),
  google_search_console: lazy(
    () => import("./GoogleSearchConsoleIntegrationModal"),
  ),
  amazon_seller: lazy(() => import("./AmazonSellerIntegrationModal")),
  tiktok_shop_seller: lazy(() => import("./TikTokShopSellerIntegrationModal")),
  shopee_seller: lazy(() => import("./ShopeeSellerIntegrationModal")),
  lazada_seller: lazy(() => import("./LazadaSellerIntegrationModal")),
  google_ads: lazy(() => import("./GoogleAdsIntegrationModal")),
  firebase: lazy(() => import("./FirebaseIntegrationModal")),
  warehouse: lazy(() => import("./WarehouseIntegrationModal")),
  all_connectors: lazy(() => import("./AllConnectorsModal")),
};

export function selectActiveModal(state: ChatState): ModalId | null {
  for (const [flag, id] of MODAL_FLAGS) {
    if (state[flag]) return id;
  }
  return null;
}

export const CONNECTOR_MODAL_IDS: readonly ModalId[] = MODAL_FLAGS.map(
  ([, id]) => id,
);

export function ConnectorModalHost() {
  // A narrow selector returning a string or null: this component re-renders
  // when the open modal changes, not on every store write.
  const active = useChatStore(selectActiveModal);
  if (!active) return null;

  const Modal = REGISTRY[active];
  return (
    <Suspense fallback={null}>
      <Modal />
    </Suspense>
  );
}

export default ConnectorModalHost;
