import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-[#121416] text-gray-200">
        <div className="max-w-md w-full bg-[#1b1e22] border border-red-500/30 rounded-2xl p-6 text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">Something went wrong</h1>
          <p className="text-sm text-gray-400 break-words">{this.state.error.message}</p>
          <div className="flex justify-center gap-2">
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 rounded-lg bg-[#272d33] hover:bg-[#343b44] text-sm text-gray-300 font-medium cursor-pointer"
            >
              Try again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-sm font-semibold cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Reload app
            </button>
          </div>
        </div>
      </div>
    );
  }
}
