const STATIC_ROUTES = [
  "",
  "about",
  "pricing",
  "finance",
  "privacy",
  "terms",
  "docs",
  "login",
  "signup",
  "waitlist",
  "workspace",
  "workspace/project",
  "workspace/news-preview",
  "workspace/project/preview",
  "templates",
  "feedback",
  "admin/analytics",
  "admin/users",
  "admin/chat-logs",
  "admin/cms",
  "admin/cms/new",
  "sso-callback",
  "landingpage",
  "features",
  "security",
  "product/data-connectors",
  "product/workspace-agents",
  "vs",
  "blog",
  "customers",
] as const;

const DYNAMIC_ROUTES = [
  /^zalo-upload\/[^/]+$/,
  /^workspace\/connectors\/[^/]+\/[^/]+$/,
  /^preview\/[^/]+$/,
  /^admin\/conversation\/[^/]+$/,
  /^admin\/users\/[^/]+$/,
  /^admin\/cms\/[^/]+$/,
  /^product\/data-connectors\/[^/]+$/,
  /^product\/workspace-agents\/[^/]+$/,
  /^vs\/[^/]+$/,
  /^blog\/[^/]+$/,
  /^customers\/[^/]+$/,
] as const;

const EXACT_REDIRECTS: Readonly<Record<string, string>> = {
  admin: "/admin/analytics",
  cancel: "/pricing",
  integrations: "/product/data-connectors",
  product: "/product/data-connectors",
  success: "/pricing",
  workspaces: "/product/workspace-agents",
};

export const STATIC_ROUTE_PATHS: readonly string[] = STATIC_ROUTES;

export function routeFromSegments(slug?: string[]): string {
  return (slug ?? []).join("/");
}

export function redirectForRoute(route: string): string | undefined {
  if (EXACT_REDIRECTS[route]) return EXACT_REDIRECTS[route];
  if (/^integrations\/[^/]+$/.test(route)) return "/product/data-connectors";
  if (/^workspaces\/[^/]+$/.test(route)) return "/product/workspace-agents";
  return undefined;
}

export function isKnownRoute(route: string): boolean {
  return STATIC_ROUTES.some((candidate) => candidate === route)
    || DYNAMIC_ROUTES.some((pattern) => pattern.test(route));
}

export function isPrivateRoute(route: string): boolean {
  return /^(workspace|admin|preview|templates|feedback|sso-callback|zalo-upload)(\/|$)/.test(route);
}

/**
 * Pathnames that render the signed-in app shell, which uses the 15px root
 * font-size; everything else is marketing at 14px (see `html.font-marketing`
 * in index.css).
 *
 * Deliberately distinct from isPrivateRoute, which also covers sso-callback and
 * zalo-upload. This pattern takes a leading-slash *pathname*, not a route key,
 * because it is shared verbatim with the pre-paint inline script in
 * app/layout.tsx — that script sets the class before first paint so the page no
 * longer reflows from 15px to 14px after hydration. App.tsx reuses it for
 * client-side navigations, so the two can never drift apart.
 */
export const APP_SHELL_PATH_PATTERN = /^\/(?:workspace|admin|preview|templates)|^\/feedback$/;

export function isAppShellPath(pathname: string): boolean {
  return APP_SHELL_PATH_PATTERN.test(pathname);
}

export function isNoIndexRoute(route: string): boolean {
  if (isPrivateRoute(route)) return true;
  if (/^(login|signup)(\/|$)/.test(route)) return true;
  if (/^(finance|vs|customers|product\/workspace-agents)(\/|$)/.test(route)) return true;
  return /^product\/data-connectors\/[^/]+$/.test(route);
}

export function routeLabel(route: string): string {
  const label = route ? route.split("/").at(-1)?.replace(/-/g, " ") : "AI analytics workspace";
  return label ? label.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Dreamify";
}

export interface RouteMetadata {
  title: string;
  description: string;
}

const PUBLIC_ROUTE_METADATA: Readonly<Record<string, RouteMetadata>> = {
  "": {
    title: "AI analytics workspace",
    description: "Turn bounded data files into explainable insights and editable dashboards in an invite-only Hobby demo.",
  },
  about: {
    title: "About",
    description: "How the Dreamify invite-only analytics demo is designed and operated.",
  },
  blog: {
    title: "Blog",
    description: "Practical guides to data analysis, visualization, and dashboard design.",
  },
  docs: {
    title: "Preview guide",
    description: "Bootstrap, usage limits, security boundaries, and operating guidance for the Dreamify Hobby demo.",
  },
  features: {
    title: "Hobby demo features",
    description: "Bounded file upload, deterministic or BYOK analysis, editable dashboards, version history, and export.",
  },
  pricing: {
    title: "Free Preview",
    description: "One invite-only, non-commercial Hobby profile with billing and credit debits disabled.",
  },
  privacy: {
    title: "Privacy",
    description: "How the Dreamify Hobby demo handles uploaded data and optional AI provider keys.",
  },
  security: {
    title: "Security boundaries",
    description: "Security controls and explicit limitations for the private Dreamify Hobby demo.",
  },
  terms: {
    title: "Terms",
    description: "Terms for personal, non-commercial use of the Dreamify Hobby preview.",
  },
  "product/data-connectors": {
    title: "Connector availability",
    description: "File upload is active; external connector surfaces fail closed until certification succeeds.",
  },
  "product/workspace-agents": {
    title: "Workspace delivery preview",
    description: "Migrated workspace-agent UI with chat delivery and scheduling disabled by default.",
  },
};

export function routeMetadata(route: string): RouteMetadata {
  const exact = PUBLIC_ROUTE_METADATA[route];
  if (exact) return exact;

  if (route.startsWith("product/data-connectors/")) {
    return {
      title: `${routeLabel(route)} connector preview`,
      description: "A retained connector surface whose live availability is controlled by the deployed capability policy.",
    };
  }
  if (route.startsWith("product/workspace-agents/")) {
    return {
      title: `${routeLabel(route)} workspace preview`,
      description: "A retained workspace delivery surface that remains unavailable until provider certification passes.",
    };
  }
  if (route.startsWith("blog/")) {
    return {
      title: routeLabel(route),
      description: "A Dreamify guide to analytics, data visualization, and dashboard workflows.",
    };
  }

  return {
    title: routeLabel(route),
    description: isPrivateRoute(route)
      ? "Private Dreamify application route."
      : "Dreamify invite-only analytics Hobby demo.",
  };
}
