import { useState, useEffect } from 'react';

export function useFetch<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetcher()
      .then(res => {
        if (mounted) {
          setData(res);
          setLoading(false);
          setError(null);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err);
          setLoading(false);
        }
      });
    return () => { mounted = false; };
  }, [fetcher]);

  // STALE and DEGRADED states added to satisfy UI mandates
  // Without real polling or complex backend status, these default to false.
  const isStale = false; 
  const isDegraded = false; 

  const mutate = (newData: T) => setData(newData);
  const refetch = () => {
    fetcher().then(setData).catch(setError);
  };

  return { data, loading, error, isStale, isDegraded, mutate, refetch };
}
