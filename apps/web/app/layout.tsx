import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { assertHostedWebEnvironment } from "@/server/runtime-env";
import { APP_SHELL_PATH_PATTERN } from "@/lib/route-manifest";

import "@/index.css";

assertHostedWebEnvironment();

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://dreamify-web.vercel.app";

// Runs before first paint. The theme half was already here; the font-marketing
// half is new. The SPA is loaded with ssr:false, so without this the root
// font-size stayed at its 15px default until App.tsx's effect ran after
// hydration, and every marketing page visibly reflowed from 15px to 14px.
// The pattern is imported rather than duplicated so it cannot drift from the
// client-side navigation handler in App.tsx.
const bootstrapScript = `
  (function () {
    try {
      var theme = localStorage.getItem("dreamify-theme") || "light";
      var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      var isDark = theme === "dark" || (theme === "system" && prefersDark);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.classList.toggle("light", !isDark);
    } catch (_) {}
    try {
      var isAppShell = ${APP_SHELL_PATH_PATTERN.toString()}.test(window.location.pathname);
      document.documentElement.classList.toggle("font-marketing", !isAppShell);
    } catch (_) {}
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "Dreamify — Private AI Analytics Preview", template: "%s | Dreamify" },
  description: "Invitation-only, non-commercial Hobby demo for turning supported data files into explainable insights and editable dashboards.",
  applicationName: "Dreamify",
  icons: { icon: "/favicon.ico", apple: "/logo-favicon.png" },
  openGraph: {
    type: "website",
    siteName: "Dreamify",
    title: "Dreamify — Private AI Analytics Preview",
    description: "Invitation-only, non-commercial Hobby demo for supported data-file analysis and editable dashboards.",
    images: ["/og-image.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-image.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, colorScheme: "light dark" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
          rel="stylesheet"
        />
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
