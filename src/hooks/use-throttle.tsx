import { useCallback, useRef, useEffect } from 'react';

/**
 * Hook para throttlear una función - ejecuta a lo máximo una vez por `delay` ms
 * Útil para eventos costosos como zoom/pan de mapas, resize, scroll
 */
export function useThrottle<T extends (...args: any[]) => void>(
  callback: T,
  delay: number = 200
): T {
  const lastCallRef = useRef<number>(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const throttled = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallRef.current;

      if (timeSinceLastCall >= delay) {
        lastCallRef.current = now;
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        callback(...args);
      } else {
        // Schedule for later
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
          lastCallRef.current = Date.now();
          callback(...args);
          timeoutRef.current = null;
        }, delay - timeSinceLastCall);
      }
    },
    [callback, delay]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return throttled as T;
}
