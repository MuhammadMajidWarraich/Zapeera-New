import { Link } from 'react-router-dom';
import { Home, ArrowLeft } from 'lucide-react';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center max-w-md">
        <div className="text-8xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-4">404</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Page Not Found</h1>
        <p className="text-gray-500 mb-8">The page you're looking for doesn't exist in the Admin Portal.</p>
        <div className="flex items-center justify-center gap-4">
          <Link to="/backoffice/dashboard" className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium">
            <Home className="w-4 h-4" /> Go to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
