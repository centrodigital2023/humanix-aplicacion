import { useEffect, useRef, useState } from "react";

function useInView(threshold = 0.3) {
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

type Props = {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
  /** Si true, se inicia inmediatamente sin esperar al viewport */
  immediate?: boolean;
};

export function AnimatedCounter({
  value,
  suffix = "",
  prefix = "",
  duration = 1500,
  className,
  immediate = false,
}: Props) {
  const [display, setDisplay] = useState(immediate ? value : 0);
  const { ref, inView } = useInView();

  useEffect(() => {
    const shouldStart = immediate || inView;
    if (!shouldStart || value === 0) return;

    let raf: number;
    const startTime = performance.now();
    const startVal = 0;

    const tick = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(startVal + (value - startVal) * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration, immediate, inView]);

  return (
    <span ref={ref} className={className}>
      {prefix}{display.toLocaleString("es-CO")}{suffix}
    </span>
  );
}
