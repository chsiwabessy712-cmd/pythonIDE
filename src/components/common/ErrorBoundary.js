import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

export class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null, errorInfo: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    handleRetry = () => {
        this.setState({ hasError: false, error: null, errorInfo: null });
        window.location.reload();
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center p-8 bg-red-50 border border-red-200 rounded-xl text-center h-full min-h-[300px]">
                    <div className="bg-red-100 p-4 rounded-full mb-4">
                        <AlertCircle size={48} className="text-red-600" />
                    </div>
                    <h3 className="text-xl font-bold text-red-800 mb-2">Something went wrong</h3>
                    <p className="text-red-600 mb-6 max-w-md">
                        {this.state.error?.message || "An unexpected error occurred."}
                    </p>
                    {this.state.error?.message?.includes('<') && (
                        <div className="bg-white p-3 rounded border border-red-100 text-xs text-left mb-6 max-w-md overflow-auto">
                            <p className="font-bold mb-1">Potential Cause:</p>
                            <p>This "Unexpected token '&lt;'" error usually means a script failed to load (e.g., blocked by firewall) and the server returned an HTML error page instead.</p>
                        </div>
                    )}
                    <Button onClick={this.handleRetry} variant="primary" className="flex items-center gap-2">
                        <RefreshCw size={16} /> Reload Page
                    </Button>
                </div>
            );
        }

        return this.props.children;
    }
}
