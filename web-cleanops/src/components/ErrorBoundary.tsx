import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time exceptions anywhere below it and shows a recoverable
 * fallback instead of unmounting the whole tree (which appears as a blank
 * white screen). The real error is logged for diagnosis.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Render error caught by ErrorBoundary:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="w-full max-w-md animate-fade-up rounded-2xl border border-border bg-card p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <TriangleAlert className="h-6 w-6" />
          </div>
          <h1 className="mt-5 font-display text-2xl tracking-tight">Something went wrong</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This screen ran into an unexpected error. You can try again, or head back to the
            dashboard.
          </p>
          {this.state.error?.message ? (
            <p className="mt-4 rounded-lg border border-border bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
              {this.state.error.message}
            </p>
          ) : null}
          <div className="mt-6 flex items-center justify-center gap-3">
            <Button variant="outline" onClick={this.handleReset}>
              Try again
            </Button>
            <Button
              onClick={() => {
                window.location.href = "/";
              }}
            >
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
