import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/src/components/ui/button';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || 'An unexpected application error occurred.',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#060B16] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full rounded-lg border border-red-500/35 bg-[#0B1222] p-6 space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h2 className="font-display text-base font-semibold text-slate-100">
                  VisionX AI Error Boundary
                </h2>
                <p className="text-xs text-slate-400">
                  An unhandled exception or Firestore security rule denial occurred.
                </p>
              </div>
            </div>
            <pre className="overflow-x-auto rounded-md border border-slate-800 bg-[#070D1A] p-3 font-mono text-xs text-red-200 whitespace-pre-wrap">
              {this.state.errorMessage}
            </pre>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Reload Workspace</span>
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
