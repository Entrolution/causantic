import { useEffect, useState, type ReactNode } from 'react';
import { Card, CardContent } from '../ui/card';

interface StatCardProps {
  label: string;
  value: number;
  icon: ReactNode;
}

export function StatCard({ label, value, icon }: StatCardProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === 0) return;
    const duration = 600;
    const steps = 30;
    const increment = value / steps;
    let current = 0;
    const timer = setInterval(() => {
      current += increment;
      if (current >= value) {
        setDisplay(value);
        clearInterval(timer);
      } else {
        setDisplay(Math.floor(current));
      }
    }, duration / steps);
    return () => clearInterval(timer);
  }, [value]);

  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-6">
        <div className="rounded-lg bg-accent/10 p-3 text-accent">{icon}</div>
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-3xl font-bold tabular-nums">{display.toLocaleString()}</p>
        </div>
      </CardContent>
    </Card>
  );
}
