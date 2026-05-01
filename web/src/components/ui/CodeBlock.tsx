import { cn, toPrettyJson } from '@/lib/utils'

interface CodeBlockProps {
  children: unknown
  className?: string
}

export default function CodeBlock({ children, className }: CodeBlockProps) {
  return (
    <pre
      className={cn(
        'overflow-auto rounded-[1.35rem] border border-[color:rgba(255,255,255,0.08)] bg-[#1e1916] p-4 text-xs leading-6 text-[#f3ede3] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
        className
      )}
    >
      <code>{toPrettyJson(children)}</code>
    </pre>
  )
}
