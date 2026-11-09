import React, { useId } from 'react';

interface ArtDirectionInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ArtDirectionInput({ label, value, onChange, disabled, placeholder }: ArtDirectionInputProps) {
  const id = useId();
  return <div className="space-y-1.5 text-left font-sans">
    <label htmlFor={id} className="block text-xs font-bold text-slate-700">{label}</label>
    <textarea id={id} value={value} onChange={event => onChange(event.target.value)} disabled={disabled}
      maxLength={4000} rows={3} placeholder={placeholder || 'Describe the subject, mood, colors, composition, and illustration style you want…'}
      aria-describedby={`${id}-help`}
      className="w-full bg-white border border-slate-300 rounded-lg p-3 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y disabled:opacity-60" />
    <p id={`${id}-help`} className="text-xs text-slate-600">Save a prompt to use in your preferred art tool, then upload the finished image.</p>
  </div>;
}
