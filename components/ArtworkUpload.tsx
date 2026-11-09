import React, { useRef, useState } from 'react';
import { Upload, Trash2, Loader2 } from 'lucide-react';
import { readArtworkFile } from '../services/artwork';
import { formatImageSrc } from '../services/gemini';

interface ArtworkUploadProps {
  kind: 'cover' | 'chapter';
  image?: string;
  onChange: (image: string | undefined) => void;
  disabled?: boolean;
  alt?: string;
}

export function ArtworkUpload({ kind, image, onChange, disabled = false, alt }: ArtworkUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const subject = kind === 'cover' ? 'Cover Artwork' : 'Chapter Illustration';
  const busy = disabled || isUploading;

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setError('');
    setStatus('');
    try {
      const artwork = await readArtworkFile(file);
      onChange(artwork.base64);
      setStatus(`Artwork saved (${artwork.width} × ${artwork.height}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'This image could not be added. Please try another file.');
    } finally {
      setIsUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return <div className="not-prose space-y-3 font-sans text-left w-full" aria-busy={isUploading}>
    {image && <img src={formatImageSrc(image)} alt={alt || subject}
      className={kind === 'cover' ? 'max-w-[200px] w-full h-auto mx-auto rounded-lg border border-slate-200' : 'w-full h-auto rounded-lg border border-slate-200'} />}
    {!image && <p className="text-sm text-slate-600">{kind === 'cover' ? 'Add a cover created in your preferred art tool.' : 'Add an illustration created in your preferred art tool.'}</p>}
    <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" aria-label={`Upload ${subject}`}
      className="hidden" disabled={busy} onChange={handleUpload} />
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
        className="min-h-[44px] flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-xs font-bold disabled:opacity-50">
        {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
        {isUploading ? 'Preparing Image…' : `${image ? 'Replace' : 'Upload'} ${subject}`}
      </button>
      {image && <button type="button" disabled={busy} onClick={() => { onChange(undefined); setError(''); setStatus('Artwork removed.'); }}
        className="min-h-[44px] flex items-center gap-1.5 text-slate-700 hover:bg-slate-100 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50">
        <Trash2 size={14} /> Remove {subject}
      </button>}
    </div>
    <p className="text-xs text-slate-600">PNG, JPG or WebP · Up to 15 MB. Proportions preserved; large images are optimized for your book. Transparent areas print white.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {status && <p role="status" className="text-xs text-slate-600">{status}</p>}
  </div>;
}
