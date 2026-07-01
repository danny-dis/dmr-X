import { AlertTriangle, RefreshCw, ArrowLeft, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import * as React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  showStack: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback?: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, error: null, errorInfo: null, showStack: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.hash = '#/';
    window.location.reload();
  };

  handleReportIssue = () => {
    const error = this.state.error;
    const title = encodeURIComponent(`Error: ${error?.message ?? 'Unknown error'}`);
    const body = encodeURIComponent(
      `## Error Report\n\n**Message:** ${error?.message ?? 'N/A'}\n\n**Stack:**\n\`\`\`\n${error?.stack ?? 'N/A'}\n\`\`\`\n\n**Component Stack:**\n\`\`\`\n${this.state.errorInfo?.componentStack ?? 'N/A'}\n\`\`\``
    );
    window.open(`https://github.com/dmr-x/dmr-x/issues/new?title=${title}&body=${body}`, '_blank');
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const { error, errorInfo, showStack } = this.state;

      return (
        <div className="flex items-center justify-center min-h-dvh bg-bg p-6">
          <div className="max-w-lg w-full bg-surface-1 border border-border rounded-xl p-8 text-center">
            <div className="flex justify-center mb-4">
              <div className="size-12 rounded-full bg-danger-soft flex items-center justify-center">
                <AlertTriangle className="size-6 text-danger" />
              </div>
            </div>
            <h1 className="text-lg font-semibold text-fg mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-fg-muted mb-1">
              An unexpected error occurred while rendering this page.
            </p>
            {error && (
              <p className="text-xs text-danger mb-4 font-mono break-all">
                {error.message}
              </p>
            )}

            {/* Stack trace toggle */}
            {(error?.stack || errorInfo?.componentStack) && (
              <div className="mb-4 text-left">
                <button
                  onClick={() => this.setState({ showStack: !showStack })}
                  className="flex items-center gap-1.5 text-xs text-fg-muted hover:text-fg transition-colors"
                >
                  {showStack ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                  {showStack ? 'Hide' : 'Show'} details
                </button>
                {showStack && (
                  <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3">
                    {error?.stack && (
                      <div className="mb-2">
                        <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-1">Error</p>
                        <pre className="text-[11px] text-danger font-mono whitespace-pre-wrap break-all">{error.stack}</pre>
                      </div>
                    )}
                    {errorInfo?.componentStack && (
                      <div>
                        <p className="text-[10px] font-semibold text-fg-subtle uppercase tracking-wider mb-1">Component Stack</p>
                        <pre className="text-[11px] text-fg-muted font-mono whitespace-pre-wrap break-all">{errorInfo.componentStack}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-center gap-2">
              <button
                onClick={this.handleGoHome}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-fg bg-surface-2 border border-border rounded-lg hover:bg-surface-3 transition-colors"
              >
                <ArrowLeft className="size-4" />
                Dashboard
              </button>
              <button
                onClick={this.handleReload}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-hover transition-colors"
              >
                <RefreshCw className="size-4" />
                Reload
              </button>
              <button
                onClick={this.handleReportIssue}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-fg-muted bg-surface-2 border border-border rounded-lg hover:bg-surface-3 transition-colors"
              >
                <ExternalLink className="size-4" />
                Report
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
