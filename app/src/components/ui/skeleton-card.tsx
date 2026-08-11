import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <Card className="animate-pulse">
      <CardHeader>
        <div className="h-4 w-32 bg-muted rounded" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-3 bg-muted rounded flex-1" style={{ maxWidth: `${75 - i * 12}%` }} />
            <div className="h-3 w-12 bg-muted/60 rounded" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
