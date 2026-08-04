import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './utils';
import type { VisualTier } from './frameworks';

// Compliance chip colors: sensitive (high-harm) vs identifier (strip-target) vs ordinary personal.
export const TIER_CHIP: Record<VisualTier, string> = {
  sensitive: 'bg-amber-100 text-amber-800 border-amber-200',
  identifier: 'bg-blue-100 text-blue-800 border-blue-200',
  personal: 'bg-slate-100 text-slate-600 border-slate-200',
};

// ─── Design tokens ────────────────────────────────────────────────────────
// One place to change the visual language. Use these class constants everywhere;
// don't hand-roll text-* / px-* / bg-* combinations in components.

// 4 text tiers + mono. Icon sizes map to their tier.
export const T = {
  h2:    'text-lg font-medium text-slate-800',
  label: 'text-sm font-medium text-slate-700',
  body:  'text-[13px] text-slate-600',
  meta:  'text-xs text-slate-500',
  micro: 'text-[11px] uppercase tracking-wider text-slate-500 font-semibold',
  mono:  'font-mono text-slate-700',
} as const;

export const ICON = { h2: 18, label: 16, body: 14, meta: 13, micro: 13 } as const;

// ─── Button ───────────────────────────────────────────────────────────────
type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'danger' | 'accent';
type ButtonSize = 'sm' | 'md';

const V: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-sm',
  ghost:   'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-100',
  outline: 'bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 border-slate-200 shadow-sm',
  danger:  'bg-white hover:bg-rose-50 text-rose-600 border-slate-200 hover:border-rose-200',
  accent:  'bg-white hover:bg-purple-50 text-purple-600 border-slate-200 hover:border-purple-200',
};

const S: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1.5 gap-1.5 rounded-md',
  md: 'text-sm px-3 py-2 gap-2 rounded-lg',
};

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({ variant = 'outline', size = 'sm', className, children, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center border font-medium transition-colors outline-none',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        V[variant], S[size], className,
      )}
    >
      {children}
    </button>
  );
}

// ─── Chip ─────────────────────────────────────────────────────────────────
// One chip size. Pass a color-class string (border+bg+text) for the tone.
export function Chip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span className={cn(
      'inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap',
      className,
    )}>
      {children}
    </span>
  );
}

// ─── Dropdown ─────────────────────────────────────────────────────────────
// Custom select — native <select> can't be aligned/styled cross-browser and its OS
// menu overlaps the trigger on Safari/Chrome. Shared across the app.
export function Dropdown<T extends string>({
  value, options, onChange, className,
}: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const selected = options.find(o => o.value === value);
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg pl-3 pr-2.5 py-2.5 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-indigo-500"
      >
        <span className="truncate text-left">{selected?.label ?? value}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto py-1">
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm truncate',
                o.value === value ? 'text-indigo-700 bg-indigo-50 font-medium' : 'text-slate-700 hover:bg-slate-50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Section label (sidebar section header row) ──────────────────────────
export function SectionLabel({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className={cn(T.label, 'flex items-center gap-2')}>
      {icon}
      {children}
    </label>
  );
}
