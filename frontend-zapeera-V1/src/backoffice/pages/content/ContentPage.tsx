import { useState } from 'react';
import { FileText, Plus, Edit2, Trash2, BookOpen, HelpCircle, Scale, Home, Megaphone } from 'lucide-react';

interface ContentItem { id: string; title: string; type: string; status: string; updatedAt: string; }

const TABS = [
  { id: 'blog', label: 'Blog', icon: BookOpen },
  { id: 'faqs', label: 'FAQs', icon: HelpCircle },
  { id: 'legal', label: 'Legal Pages', icon: Scale },
  { id: 'static', label: 'Static Pages', icon: Home },
  { id: 'announcements', label: 'Announcements', icon: Megaphone },
];

export function ContentPage() {
  const [activeTab, setActiveTab] = useState('blog');
  const [items] = useState<ContentItem[]>([]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Content Management</h1><p className="text-sm text-gray-500 mt-1">Manage platform content, blog posts, FAQs, and legal pages</p></div>
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium"><Plus className="w-4 h-4" /> New Content</button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
        <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-600 mb-1">Content management coming soon</h3>
        <p className="text-sm text-gray-400">This section will allow you to manage blog posts, FAQs, legal pages, and static content</p>
      </div>
    </div>
  );
}
