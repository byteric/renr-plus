import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(useGSAP);
export function RouteMotion({ children, route }: { children: ReactNode; route: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (preference?.matches || document.visibilityState === 'hidden') return;
      const heading = scope.current?.querySelector('h1');
      if (!heading) return;
      // Keep form controls outside the animated target: measuring transforms can reparent it.
      const animation = gsap.fromTo(
        heading,
        { y: 5 },
        { y: 0, duration: 0.16, ease: 'power2.out', clearProps: 'transform' },
      );
      const reduced = () => {
        if (preference?.matches) animation.progress(1).pause();
      };
      preference?.addEventListener?.('change', reduced);
      return () => preference?.removeEventListener?.('change', reduced);
    },
    { scope, dependencies: [route], revertOnUpdate: true },
  );
  return (
    <div ref={scope} className="route-motion">
      {children}
    </div>
  );
}
