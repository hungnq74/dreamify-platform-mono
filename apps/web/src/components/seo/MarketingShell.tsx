import { ReactNode } from "react";
import { FooterSection } from "@/components/homepage-section/footer-section";

interface MarketingShellProps {
  children: ReactNode;
}

/**
 * Shared layout for SEO marketing pages.
 * Header is rendered by App.tsx's existing conditional — do not render it here
 * (would cause a double-header stack on these routes).
 *
 * The marketing root font-size lives on `html.font-marketing`, set before first
 * paint by app/layout.tsx. It is deliberately not applied here: the only rule is
 * `html.font-marketing`, which can never match a div.
 */
export const MarketingShell = ({ children }: MarketingShellProps) => (
  <div className="min-h-screen bg-background overflow-x-hidden">
    <main className="relative z-10 mx-auto max-w-5xl px-6 py-16 prose prose-neutral dark:prose-invert prose-headings:font-semibold prose-h1:text-4xl prose-h2:text-2xl prose-h3:text-xl">
      {children}
    </main>
    <FooterSection />
  </div>
);

export default MarketingShell;
