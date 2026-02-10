import { useState, useEffect, useRef } from 'react';
import { Search } from 'lucide-react';
import { Input } from '../ui/input';

interface SearchInputProps {
  onSearch: (query: string) => void;
  debounceMs?: number;
}

export function SearchInput({ onSearch, debounceMs = 400 }: SearchInputProps) {
  const [value, setValue] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSearch(value);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [value, debounceMs, onSearch]);

  return (
    <div className="relative max-w-xl">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search memory..."
        className="pl-10"
      />
    </div>
  );
}
