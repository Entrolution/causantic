import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface ClusterData {
  id: string;
  name: string | null;
  description: string | null;
  memberCount: number;
  exemplarPreviews: Array<{ id: string; preview: string }>;
}

interface ClusterCardProps {
  cluster: ClusterData;
}

export function ClusterCard({ cluster }: ClusterCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            {cluster.name ?? cluster.id.slice(0, 12)}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{cluster.memberCount} chunks</Badge>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
        {cluster.description && (
          <CardDescription className="line-clamp-2">{cluster.description}</CardDescription>
        )}
      </CardHeader>

      {expanded && (
        <CardContent>
          {/* Size gradient bar */}
          <div className="mb-3 h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all"
              style={{ width: `${Math.min(100, cluster.memberCount * 2)}%` }}
            />
          </div>

          {cluster.exemplarPreviews.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Exemplar Chunks</p>
              {cluster.exemplarPreviews.map((ex) => (
                <div key={ex.id} className="rounded border border-border p-2 text-xs text-muted-foreground">
                  <code className="text-[10px]">{ex.id.slice(0, 8)}</code>
                  <p className="mt-1 line-clamp-2">{ex.preview}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
