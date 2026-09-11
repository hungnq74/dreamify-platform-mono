import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors anywhere under <Routes>, including a failed lazy chunk.
 *
 * Intentionally not reusing components/charts/ErrorBoundary. That one recovers
 * by calling setState after a delay, which cannot work here: React.lazy caches
 * the rejected import promise, so re-rendering the same lazy component re-throws
 * the same error forever. A chunk that failed to load — usually because a deploy
 * replaced the file the running page was pointing at — only recovers on a full
 * reload, so that is the action offered.
 *
 * Before this existed, the app had no boundary outside the chart tree, so any
 * render error blanked the whole page with nothing on screen and no way back.
 */
export class RouteErrorBoundary extends Component<
  RouteErrorBoundaryProps,
  RouteErrorBoundaryState
> {
  state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Route failed to render:", error, errorInfo.componentStack);
  }

  private handleReload = () => {
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const looksLikeChunkFailure =
      /Loading chunk|dynamically imported module|Failed to fetch/i.test(
        error.message,
      );

    return (
      <div className="mx-auto flex min-h-[60vh] w-full max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
        <h1 className="text-xl font-semibold">This page didn’t load</h1>
        <p className="text-sm text-muted-foreground">
          {looksLikeChunkFailure
            ? "Part of the app failed to download. This usually means a new version was deployed while the page was open."
            : "Something went wrong while rendering this page."}
        </p>
        <Button onClick={this.handleReload}>Reload the page</Button>
      </div>
    );
  }
}

export default RouteErrorBoundary;
