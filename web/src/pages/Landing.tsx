// The landing page, built from the "Landing" artboards in the Paper file (desktop,
// tablet and mobile). The hero is a still photograph that has been made to breathe:
//
// - the plant and its shadow on the wall sway in a light wind (an SVG turbulence
//   field displacing a copy of the photo, masked to that corner),
// - sunlight comes through a curtain we never see: soft folds of shade drift across
//   the lit patch of wall and the light swells and settles as they move,
// - a few dust motes hang in the beam, and the brain sketch glows faintly.
//
// Every overlay sits inside one box locked to the photo's 1440 x 940 frame, so the
// effects stay pinned to the plant, the wall and the head at any screen size. All of it
// stops for prefers-reduced-motion. Nothing here touches the brain viewer.

import { Link } from "react-router-dom";
import "./landing.css";

const HERO = "/landing/hero.webp";
const HERO_2X = "/landing/hero@2x.webp";

/** Node points on the brain sketch, in the photo's 1440 x 940 pixel frame. */
const NODES: [number, number][] = [
  [923, 328], [982, 343], [1032, 335], [1050, 335], [922, 364], [1027, 379],
  [1082, 399], [1053, 404], [931, 408], [1010, 426], [1092, 433],
];

/** Dust in the beam. Fixed, not random, so the page renders the same every time. */
const MOTES = Array.from({ length: 18 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    x: 56 + r(1) * 40,
    y: 18 + r(2) * 62,
    size: 1.4 + r(3) * 2.2,
    dur: 16 + r(4) * 14,
    delay: -r(5) * 30,
    drift: (r(6) - 0.5) * 60,
  };
});

const STEPS = [
  {
    n: "01",
    title: "Check in",
    body: "Patients complete brief cognitive tasks over video between medical appointments.",
  },
  {
    n: "02",
    title: "Understand change",
    body: "AI analyzes responses and observable performance patterns to identify changes over time.",
  },
  {
    n: "03",
    title: "Stay informed",
    body: "Clinicians review assessment results and longitudinal trends through their medical dashboard.",
  },
];

const px = (x: number) => `${(x / 1440) * 100}%`;
const py = (y: number) => `${(y / 940) * 100}%`;

/** The photograph and everything that moves on it. */
function Scene() {
  return (
    <div className="lp-scene" aria-hidden="true">
      <svg className="lp-defs" width="0" height="0" focusable="false">
        <defs>
          {/* Leaves: a fine, quick flutter that swells in gusts. */}
          <filter id="lp-wind" x="-5%" y="-5%" width="110%" height="110%">
            <feTurbulence type="fractalNoise" baseFrequency="0.011 0.026" numOctaves="2" seed="7" result="n">
              <animate
                attributeName="baseFrequency"
                dur="9s"
                values="0.011 0.026;0.014 0.031;0.010 0.024;0.011 0.026"
                repeatCount="indefinite"
              />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" in2="n" scale="5" xChannelSelector="R" yChannelSelector="G">
              <animate
                attributeName="scale"
                dur="7s"
                values="3;8;4;9;3"
                keyTimes="0;0.3;0.5;0.75;1"
                repeatCount="indefinite"
              />
            </feDisplacementMap>
          </filter>
        </defs>
      </svg>

      <picture>
        <source type="image/webp" srcSet={`${HERO} 1440w, ${HERO_2X} 2880w`} sizes="(max-width: 767px) 520px, 100vw" />
        <img className="lp-photo" src={HERO} alt="" decoding="async" fetchPriority="high" />
      </picture>

      {/* The same photo again, cut down to the plant and its shadow, pushed by the wind. */}
      <div className="lp-plant" />

      {/* Light through a curtain: folds of shade drifting over the lit wall. */}
      <div className="lp-curtain">
        <div className="lp-folds" />
      </div>
      <div className="lp-sun" />
      <div className="lp-beam" />

      <div className="lp-motes">
        {MOTES.map((m, i) => (
          <span
            key={i}
            style={
              {
                left: `${m.x}%`,
                top: `${m.y}%`,
                width: m.size,
                height: m.size,
                animationDuration: `${m.dur}s`,
                animationDelay: `${m.delay}s`,
                "--drift": `${m.drift}px`,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      <div className="lp-brain" style={{ left: px(1006), top: py(382) }} />
      {NODES.map(([x, y], i) => (
        <span
          key={i}
          className="lp-node"
          style={{ left: px(x), top: py(y), animationDelay: `${(i * 0.73) % 5}s` }}
        />
      ))}
    </div>
  );
}

export default function Landing() {
  return (
    <div className="lp">
      <section className="lp-hero">
        <div className="lp-scene-wrap">
          <Scene />
        </div>

        <nav className="lp-nav">
          <span className="lp-word">synapshot</span>
          <Link to="/clinic" className="lp-login">
            Login
          </Link>
        </nav>

        <div className="lp-copy">
          <h1 className="lp-h1">
            Ongoing insight <br className="lp-br" />
            for recovering <br className="lp-br" />
            minds
          </h1>
          <p className="lp-sub">
            AI-powered neurological checkups between visits using simple cognition tests analyzed
            over video.
          </p>
        </div>
      </section>

      <main className="lp-body">
        <section className="lp-how" aria-labelledby="lp-how-title">
          <h2 id="lp-how-title" className="lp-h2">
            How Synapshot works
          </h2>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n} className="lp-step lp-reveal">
                <span className="lp-n">{s.n}</span>
                <h3 className="lp-step-title">{s.title}</h3>
                <p className="lp-step-body">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-close lp-reveal">
          <p>
            Recovery doesn’t stop between appointments. Neither should our understanding of it.
          </p>
        </section>

        <footer className="lp-foot">
          <span>© 2026 Synapshot</span>
          <span>Research prototype. Not a replacement for professional medical evaluation.</span>
        </footer>
      </main>
    </div>
  );
}
