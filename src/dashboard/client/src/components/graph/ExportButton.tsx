import { Download } from 'lucide-react';

interface ExportButtonProps {
  svgRef: SVGSVGElement | null;
}

export function ExportButton({ svgRef }: ExportButtonProps) {
  const handleExport = () => {
    if (!svgRef) return;

    const serializer = new XMLSerializer();
    const svgString = serializer.serializeToString(svgRef);
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'causantic-graph.svg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      disabled={!svgRef}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted transition-colors disabled:opacity-50"
    >
      <Download className="h-4 w-4" />
      Export SVG
    </button>
  );
}
