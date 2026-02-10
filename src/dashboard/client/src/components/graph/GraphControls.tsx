import { useApi } from '../../hooks/use-api';
import { Select } from '../ui/select';

interface ProjectsResponse {
  projects: Array<{ slug: string; chunkCount: number }>;
}

interface GraphControlsProps {
  project: string;
  onProjectChange: (project: string) => void;
  limit: number;
  onLimitChange: (limit: number) => void;
}

export function GraphControls({ project, onProjectChange, limit, onLimitChange }: GraphControlsProps) {
  const { data: projectsData } = useApi<ProjectsResponse>('/api/projects');

  const projectOptions = (projectsData?.projects ?? []).map((p) => ({
    value: p.slug,
    label: `${p.slug} (${p.chunkCount})`,
  }));

  return (
    <div className="flex items-center gap-4">
      <Select
        value={project}
        onChange={(e) => onProjectChange(e.target.value)}
        options={projectOptions}
        placeholder="All projects"
        className="w-60"
      />
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>Nodes:</span>
        <input
          type="range"
          min={50}
          max={500}
          step={50}
          value={limit}
          onChange={(e) => onLimitChange(Number(e.target.value))}
          className="w-32"
        />
        <span className="tabular-nums w-8">{limit}</span>
      </div>
    </div>
  );
}
