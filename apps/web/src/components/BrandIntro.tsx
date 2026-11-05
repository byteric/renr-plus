import '../brand.css';

export function BrandIntro() {
  return (
    <section className="brand-intro" aria-labelledby="brand-heading">
      <p className="eyebrow">
        <span /> GESTÃO PREVENTIVA · RETECH+
      </p>
      <h2 id="brand-heading">
        Da informação a uma <em>decisão rastreável</em>
        <span className="title-dot">.</span>
      </h2>
      <p className="brand-description">
        Conecte o diagnóstico, organize os riscos e preserve o contexto de cada decisão.
      </p>
      <div className="brand-illustration" aria-hidden="true">
        <svg viewBox="0 0 520 270" fill="none" focusable="false">
          <path className="brand-orbit" d="M48 145V89Q48 57 80 57H430Q472 57 472 99V145" />
          <path className="brand-connector" d="M48 145v53q0 23 28 23h368q28 0 28-28v-48" />
          <image
            className="brand-symbol-light"
            href="/brand/renr-plus-symbol.svg"
            x="152"
            y="27"
            width="216"
            height="216"
          />
          <image
            className="brand-symbol-dark"
            href="/brand/renr-plus-symbol-dark.svg"
            x="152"
            y="27"
            width="216"
            height="216"
          />
          <circle className="brand-node" cx="48" cy="145" r="24" />
          <path className="brand-node-icon" d="M38 151v-8m10 8v-17m10 17v-12" />
          <circle className="brand-node brand-node-end" cx="472" cy="145" r="24" />
          <path className="brand-node-icon" d="M463 136h18m-18 9h18m-18 9h11" />
          <circle className="brand-spark" cx="120" cy="221" r="5" />
          <circle className="brand-spark" cx="402" cy="57" r="5" />
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
