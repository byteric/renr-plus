import { useRef } from 'react';
import { usePresentationMotion } from '../hooks/usePresentationMotion';
import '../brand.css';

export function BrandIntro() {
  const scope = useRef<HTMLElement>(null);
  usePresentationMotion(scope, 'brand', true);
  return (
    <section ref={scope} className="brand-intro" aria-labelledby="brand-heading">
      <p className="eyebrow">
        <span /> GESTÃO PREVENTIVA · RETECH+
      </p>
      <h1 id="brand-heading">
        Da informação a uma <em>decisão rastreável</em>
        <span className="title-dot">.</span>
      </h1>
      <p className="brand-description">
        Conecte o diagnóstico, organize os riscos e preserve o contexto de cada decisão.
      </p>
      <div className="brand-illustration" aria-hidden="true">
        <svg data-motion-illustration="" viewBox="0 0 520 270" fill="none" focusable="false">
          <path
            className="brand-orbit"
            d="M28 180C95 254 409 253 490 131M42 106C113 23 394 24 474 105"
          />
          <path data-motion-connection="" className="brand-connector" d="M48 145H173M347 145H472" />
          <path
            className="brand-shield-shadow"
            d="m260 37 98 36v75c0 51-52 86-98 105-46-19-98-54-98-105V73z"
          />
          <path
            className="brand-shield"
            d="m260 18 91 34v75c0 51-45 83-91 105-46-22-91-54-91-105V52z"
          />
          <path className="brand-shield-plane" d="m260 18 91 34-91 74-91-74z" />
          <path className="brand-shield-fold" d="m260 126 91-74v75c0 51-45 83-91 105z" />
          <path className="brand-check" d="m221 126 27 27 54-60" />
          <circle className="brand-node" cx="48" cy="145" r="24" />
          <path className="brand-node-icon" d="M38 151v-8m10 8v-17m10 17v-12" />
          <circle className="brand-node brand-node-end" cx="472" cy="145" r="24" />
          <path className="brand-node-icon" d="M463 136h18m-18 9h18m-18 9h11" />
          <circle className="brand-spark" cx="119" cy="61" r="5" />
          <circle className="brand-spark" cx="405" cy="210" r="7" />
          <path className="brand-spark-line" d="M403 47v18m-9-9h18" />
        </svg>
      </div>
      <ol className="brand-journey" aria-label="Jornada de gestão preventiva">
        <li>
          <span>01</span>
          <strong>Diagnóstico</strong>
          <small>Compreender o contexto</small>
        </li>
        <li>
          <span>02</span>
          <strong>Inventário</strong>
          <small>Organizar os registros</small>
        </li>
        <li>
          <span>03</span>
          <strong>Ficha preliminar</strong>
          <small>Preservar a origem</small>
        </li>
      </ol>
      <p className="brand-scope">
        Informação organizada para apoiar a prevenção. A ficha preliminar não substitui uma
        avaliação técnica validada.
      </p>
    </section>
  );
}
