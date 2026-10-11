import React, { useState, useRef, useEffect, useId } from 'react';
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
type ButtonVariant = 'primary' | 'ghost' | 'outline';
type ButtonSize = 'sm' | 'md';

const V: Record<ButtonVariant, string> = {
  primary: 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-600 shadow-sm',
  ghost:   'bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border-indigo-100',
  outline: 'bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 border-slate-200 shadow-sm',
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
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  // Keep the keyboard-highlighted option in view.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);
  const selected = options.find(o => o.value === value);
  const show = () => { setActive(Math.max(0, options.findIndex(o => o.value === value))); setOpen(true); };
  const pick = (i: number) => { onChange(options[i].value); setOpen(false); };
  // Focus stays on the trigger; arrows move a highlight (aria-activedescendant), like a native select.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); show(); }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab') { setOpen(false); return; }
    e.preventDefault();
    if (e.key === 'ArrowDown') setActive(i => Math.min(options.length - 1, i + 1));
    else if (e.key === 'ArrowUp') setActive(i => Math.max(0, i - 1));
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(options.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') pick(active);
  };
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
        className="w-full flex items-center justify-between gap-2 bg-slate-50 border border-slate-200 text-slate-700 text-sm rounded-lg pl-3 pr-2.5 py-2.5 outline-none hover:bg-slate-100 focus:ring-1 focus:ring-indigo-500"
      >
        <span className="truncate text-left">{selected?.label ?? value}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div id={listId} role="listbox" className="absolute left-0 right-0 top-full mt-1 z-40 bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto py-1">
          {options.map((o, i) => (
            <button
              key={o.value}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={o.value === value}
              tabIndex={-1}
              onClick={() => pick(i)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'w-full text-left px-3 py-1.5 text-sm truncate',
                o.value === value ? 'text-indigo-700 font-medium' : 'text-slate-700',
                i === active ? (o.value === value ? 'bg-indigo-100' : 'bg-slate-100') : (o.value === value && 'bg-indigo-50'),
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

// ─── Tip ──────────────────────────────────────────────────────────────────
// Explanatory bubble behind an info icon. A native popover: it renders in the top layer, so
// the scrolling sidebar cannot clip it, and it works by tap and keyboard, which `title` alone
// does not. `title` stays for mouse hover.
export function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  const id = useId();
  const bubble = useRef<HTMLDivElement>(null);
  const place = (e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!bubble.current) return;
    bubble.current.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 272))}px`;
    bubble.current.style.top = `${r.bottom + 6}px`;
  };
  return (
    <>
      <button type="button" popoverTarget={id} onClick={place} title={text} aria-label={text}
        className="inline-flex rounded outline-none focus-visible:ring-1 focus-visible:ring-indigo-500">
        {children}
      </button>
      <div ref={bubble} id={id} popover="auto"
        className="fixed inset-auto m-0 w-64 rounded-lg border border-slate-200 bg-white p-3 text-xs font-normal leading-snug text-slate-600 shadow-lg">
        {text}
      </div>
    </>
  );
}
