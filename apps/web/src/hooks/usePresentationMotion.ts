import type { RefObject } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP);

/** Presentation only: semantic text and every control remain available at all times. */
export function usePresentationMotion(
  scope: RefObject<HTMLElement | null>,
  dataset: unknown,
  narrative = false,
) {
  useGSAP(
    () => {
      const root = scope.current;
      const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (!root || !preference || preference.matches || document.visibilityState === 'hidden')
        return;
      const values = root.querySelectorAll('[data-motion-value]');
      const bars = root.querySelectorAll('[data-chart-bar]');
      const rings = root.querySelectorAll('[data-chart-ring]');
      const illustration = root.querySelector('[data-motion-illustration]');
      const animation = gsap.timeline({ defaults: { duration: 0.36, ease: 'power2.out' } });
      if (values.length)
        animation.fromTo(values, { y: 8 }, { y: 0, stagger: 0.025, clearProps: 'transform' }, 0);
      if (bars.length)
        animation.fromTo(
          bars,
          { scaleX: 0.02 },
          { scaleX: 1, stagger: 0.01, clearProps: 'transform' },
          0,
        );
      rings.forEach((ring) => {
        const completed = Number(ring.getAttribute('stroke-dasharray')?.split(' ')[0] ?? 0);
        animation.fromTo(
          ring,
          { strokeDashoffset: completed },
          { strokeDashoffset: 0, clearProps: 'strokeDashoffset' },
          0,
        );
      });
      if (illustration)
        animation.fromTo(illustration, { y: 10 }, { y: 0, clearProps: 'transform' }, 0);
      let connection: gsap.core.Tween | undefined;
      if (narrative) {
        const path = root.querySelector('[data-motion-connection]');
        if (path) {
          gsap.registerPlugin(ScrollTrigger);
          connection = gsap.fromTo(
            path,
            { strokeDashoffset: 24 },
            {
              strokeDashoffset: 0,
              duration: 0.4,
              ease: 'power2.out',
              immediateRender: false,
              scrollTrigger: { trigger: path, start: 'top bottom', once: true },
            },
          );
        }
      }
      const finish = () => {
        animation.progress(1).pause();
        connection?.progress(1).pause();
        connection?.scrollTrigger?.kill();
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
    { scope, dependencies: [dataset, narrative], revertOnUpdate: true },
  );
}
