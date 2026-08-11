import { cn } from '@/lib/utils'

interface BigMessageProps {
  icon?: React.ReactNode
  message: string
  children?: React.ReactNode
  className?: string
}

export function BigMessage({ icon, message, children, className }: BigMessageProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 text-center', className)}>
      {icon && <div className="text-muted-foreground mb-4">{icon}</div>}
      <p className="text-lg text-muted-foreground mb-4">{message}</p>
      {children}
    </div>
  )
}
