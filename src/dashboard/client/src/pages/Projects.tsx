import { useApi } from '../hooks/use-api';
import { Spinner } from '../components/ui/spinner';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

interface ProjectInfo {
  slug: string;
  chunkCount: number;
  firstSeen: string;
  lastSeen: string;
  path?: string;
}

interface ProjectsResponse {
  projects: ProjectInfo[];
}

export function Projects() {
  const { data, loading } = useApi<ProjectsResponse>('/api/projects');

  if (loading || !data) return <Spinner />;

  return (
    <div className="space-y-6 animate-fade-in">
      <h1 className="text-2xl font-bold">Projects</h1>

      {data.projects.length === 0 ? (
        <div className="text-muted-foreground">No projects found.</div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Project
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Chunks
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      First Seen
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Last Seen
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((project) => (
                    <tr
                      key={project.slug}
                      className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{project.slug}</span>
                          {project.path && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {project.path}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge variant="secondary">{project.chunkCount}</Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(project.firstSeen).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(project.lastSeen).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
