import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ImageKitUploader from './ImageKitUploader';
import BrandLogo from './BrandLogo';

export default function BrandingSettings() {
  const queryClient = useQueryClient();
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: async () => (await fetch('/api/branding')).json() });
  const [form, setForm] = useState(branding || {});

  React.useEffect(() => {
    if (branding) setForm(branding);
  }, [branding]);

  const updateMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await fetch('/api/branding', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branding'] }),
  });

  if (!branding) return <div>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      <h2 className="text-xl font-bold text-slate-100">Branding Settings</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-400 text-xs">Business Name</label>
          <input className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-slate-100" value={form.name || ''} onChange={(e) => setForm({...form, name: e.target.value})} />
        </div>
        <div>
          <label className="block text-slate-400 text-xs">Primary Logo</label>
          <BrandLogo url={form.logoUrl} name={form.name} size={100} />
          <ImageKitUploader folder="branding" onUploadSuccess={(url) => setForm({...form, logoUrl: url})} onUploadError={() => {}} />
        </div>
      </div>
      <button onClick={() => updateMutation.mutate(form)} className="px-4 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold">Save Changes</button>
    </div>
  );
}
