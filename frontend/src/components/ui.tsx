import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SelectPrimitive from '@radix-ui/react-select'
import { Slot } from '@radix-ui/react-slot'
import { Check, ChevronDown } from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'
import { useId, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react'
import { cn } from '../lib/cn'

const buttonVariants = cva('inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-semibold transition-colors disabled:opacity-50', { variants: { variant: { primary: 'bg-accent text-white hover:opacity-90', secondary: 'border border-line bg-white hover:bg-canvas', ghost: 'hover:bg-canvas', danger: 'bg-danger text-white' } }, defaultVariants: { variant: 'primary' } })

export function Button({ className, variant, asChild = false, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : 'button'
  return <Component className={cn(buttonVariants({ variant }), className)} {...props}/>
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) { return <div className={cn('card p-5', className)} {...props}/> }

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'success' | 'warning' | 'danger' }) { return <span className={cn('inline-flex rounded-control px-2 py-1 text-xs font-semibold', tone === 'success' && 'bg-green-50 text-success', tone === 'warning' && 'bg-amber-50 text-warning', tone === 'danger' && 'bg-red-50 text-danger', tone === 'neutral' && 'bg-canvas text-muted')}>{children}</span> }

export function State({ kind, message, retry }: { kind: 'loading' | 'empty' | 'error'; message?: string; retry?: () => void }) { return <div className="flex min-h-36 flex-col items-center justify-center gap-3 text-sm text-muted" role="status"><span>{message || { loading: '正在加载…', empty: '暂无数据', error: '加载失败' }[kind]}</span>{kind === 'error' && retry && <Button variant="secondary" onClick={retry}>重试</Button>}</div> }

export function SectionTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="mb-5 flex items-center justify-between gap-4"><h2 className="m-0 text-lg font-semibold">{title}</h2>{action}</div> }

export function Disclosure({ title, description, badge, defaultOpen = false, children }: { title: string; description?: string; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  return <div>
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-panel border border-accent/30 bg-accent/5 px-4 py-4 text-left text-ink transition hover:border-accent/60 hover:bg-accent/10 focus:outline-none focus:ring-2 focus:ring-accent/30"
      aria-expanded={open}
      aria-controls={contentId}
      onClick={() => setOpen(value => !value)}
    >
      <span className="min-w-0">
        <span className="block font-semibold">{title}</span>
        {description && <span className="mt-1 block text-sm font-normal text-muted">{description}</span>}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        {badge}
        <span className="text-sm font-semibold text-accent">{open ? '收起' : '展开'}</span>
        <ChevronDown size={19} className={cn('text-accent transition-transform', open && 'rotate-180')}/>
      </span>
    </button>
    {open && <div id={contentId} className="pt-4">{children}</div>}
  </div>
}

export function DetailDialog({ open, onOpenChange, title, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode }) { return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-20 bg-black/30"/><DialogPrimitive.Content className="fixed right-0 top-0 z-30 h-full w-full max-w-md bg-white p-7 shadow-panel"><div className="mb-6 flex items-center justify-between"><DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title><DialogPrimitive.Close asChild><Button variant="ghost">关闭</Button></DialogPrimitive.Close></div>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root> }

export function CenterDialog({ open, onOpenChange, title, children, dismissible = true }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; children: ReactNode; dismissible?: boolean }) { return <DialogPrimitive.Root open={open} onOpenChange={next => { if (dismissible || next) onOpenChange(next) }}><DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-ink/45 backdrop-blur-[3px]"/><DialogPrimitive.Content onEscapeKeyDown={event => { if (!dismissible) event.preventDefault() }} onPointerDownOutside={event => { if (!dismissible) event.preventDefault() }} onInteractOutside={event => { if (!dismissible) event.preventDefault() }} className="center-dialog fixed left-1/2 top-1/2 z-50 max-h-[88vh] w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-panel border border-line bg-white p-6"><div className="mb-5 flex items-start justify-between gap-3"><DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>{dismissible && <DialogPrimitive.Close asChild><Button variant="ghost" aria-label="关闭弹窗">关闭</Button></DialogPrimitive.Close>}</div>{children}</DialogPrimitive.Content></DialogPrimitive.Portal></DialogPrimitive.Root> }

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) { return <input className={cn('h-10 w-full rounded-control border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent disabled:opacity-50', className)} {...props}/> }
export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea className={cn('min-h-24 w-full rounded-control border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-accent disabled:opacity-50', className)} {...props}/> }
export function FormField({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) { return <div className="space-y-1.5"><label htmlFor={htmlFor} className="block text-sm font-semibold">{label}</label>{children}{hint && <p className="m-0 text-sm text-muted">{hint}</p>}</div> }
export function SelectInput({ value, onValueChange, options, label, placeholder = '请选择' }: { value: string; onValueChange: (value: string) => void; options: { value: string; label: string }[]; label: string; placeholder?: string }) { return <SelectPrimitive.Root value={value} onValueChange={onValueChange}><SelectPrimitive.Trigger aria-label={label} className="flex h-10 w-full items-center justify-between rounded-control border border-line bg-white px-3 text-sm text-ink outline-none focus:border-accent"><SelectPrimitive.Value placeholder={placeholder}/><SelectPrimitive.Icon><ChevronDown size={15}/></SelectPrimitive.Icon></SelectPrimitive.Trigger><SelectPrimitive.Portal><SelectPrimitive.Content position="popper" className="z-[70] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-control border border-line bg-white p-1 shadow-panel"><SelectPrimitive.Viewport>{options.map(option => <SelectPrimitive.Item key={option.value} value={option.value} className="relative flex cursor-pointer select-none items-center rounded-control py-2 pl-8 pr-3 text-sm outline-none data-[highlighted]:bg-canvas"><SelectPrimitive.ItemIndicator className="absolute left-2"><Check size={14}/></SelectPrimitive.ItemIndicator><SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText></SelectPrimitive.Item>)}</SelectPrimitive.Viewport></SelectPrimitive.Content></SelectPrimitive.Portal></SelectPrimitive.Root> }
