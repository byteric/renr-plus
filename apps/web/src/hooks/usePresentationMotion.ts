import type { RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';

gsap.registerPlugin(useGSAP);

/** Presentation only: semantic text and every control remain available at all times. */
export function usePresentationMotion(scope: RefObject<HTMLElement | null>, dataset: unknown) {
  useGSAP(
    () => {
      const root = scope.current;
      const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (!root || !preference || preference.matches || document.visibilityState === 'hidden')
        return;
      const content = root.matches('[data-motion-content]')
        ? root
        : root.querySelector('[data-motion-content]');
      const values = root.querySelectorAll('[data-motion-value]');
      const bars = root.querySelectorAll('[data-chart-bar]');
      const series = root.querySelectorAll('[data-chart-series]');
      const rings = root.querySelectorAll('[data-chart-ring]');
      const animation = gsap.timeline({ defaults: { duration: 0.45, ease: 'power2.out' } });
      if (content)
        animation.fromTo(content, { y: 4 }, { y: 0, duration: 0.18, clearProps: 'transform' }, 0);
      if (values.length)
        animation.fromTo(
          values,
          { y: 8 },
          { y: 0, duration: 0.18, stagger: { amount: 0.035 }, clearProps: 'transform' },
          0,
        );
      if (bars.length)
        animation.fromTo(
          bars,
          { scaleX: 0.02 },
          { scaleX: 1, duration: 0.415, stagger: { amount: 0.035 }, clearProps: 'transform' },
          0,
        );
      if (series.length)
        animation.fromTo(series, { scaleY: 0.2 }, { scaleY: 1, clearProps: 'transform' }, 0);
      rings.forEach((ring) => {
        const completed = Number(ring.getAttribute('stroke-dasharray')?.split(' ')[0] ?? 0);
        animation.fromTo(
          ring,
          { strokeDashoffset: completed },
          { strokeDashoffset: 0, clearProps: 'strokeDashoffset' },
          0,
        );
      });
      const finish = () => {
        animation.progress(1).pause();
      };
      const visibility = () => {
        if (document.visibilityState === 'hidden') finish();
      };
      const reduced = () => {
        if (preference.matches) finish();
      };
      const observer =
        typeof IntersectionObserver === 'undefined'
          ? null
          : new IntersectionObserver(([entry]) => {
              if (entry && !entry.isIntersecting) finish();
            });
      observer?.observe(root);
      preference.addEventListener?.('change', reduced);
      document.addEventListener('visibilitychange', visibility);
      return () => {
        observer?.disconnect();
        preference.removeEventListener?.('change', reduced);
        document.removeEventListener('visibilitychange', visibility);
      };
    },
    { scope, dependencies: [dataset], revertOnUpdate: true },
  );
}
