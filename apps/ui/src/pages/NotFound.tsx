import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
      <h1 className="text-6xl font-black text-[#F7A51C] mb-4">404</h1>
      <p className="text-lg text-[#A6A6B0] mb-6">Page not found</p>
      <Link
        to="/"
        className="flex items-center gap-2 px-4 py-2 bg-[#F7A51C] text-[#060608] rounded-md text-sm font-semibold hover:bg-[#F7A51C]/90 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Dashboard
      </Link>
    </div>
  );
}
