import { useRef, type ReactNode } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
gsap.registerPlugin(useGSAP);
export function RouteMotion({ children, route }: { children: ReactNode; route: string }) {
  const scope = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const heading = scope.current?.querySelector('h1');
      if (!heading) return;
      // Keep form controls outside the animated target: measuring transforms can reparent it.
      gsap.fromTo(
        heading,
        { y: 8 },
        { y: 0, duration: 0.22, ease: 'power2.out', clearProps: 'transform' },
      );
    },
    { scope, dependencies: [route], revertOnUpdate: true },
  );
  return (
    <div ref={scope} className="route-motion">
      {children}
    </div>
  );
}
