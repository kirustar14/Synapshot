const STEPS = [
  {
    n: "01",
    title: "Check in",
    body: "Patients complete brief cognitive tasks over video between visits.",
  },
  {
    n: "02",
    title: "Understand change",
    body: "AI analyzes performance patterns and changes over time.",
  },
  {
    n: "03",
    title: "Stay informed",
    body: "Clinicians review check-in results and longitudinal trends.",
  },
];
export default function Landing({ active = true }: { active?: boolean }) {
  return (
    <main
      className={`landing-copy public-copy ${active ? "is-active" : ""}`}
      aria-hidden={!active}
      inert={!active}
    >
      <section className="lp-hero" aria-labelledby="lp-title">
        <h1 id="lp-title" tabIndex={-1}>
          Ongoing insight <br />
          for recovering <br />
          minds.
        </h1>
        <p>
          Video-based cognitive assessments that help clinicians track
          neurological recovery between visits.
        </p>
      </section>
      <section className="lp-how-section" aria-labelledby="lp-how-title">
        <h2 id="lp-how-title">How Synapshot works</h2>
        <div className="lp-steps">
          {STEPS.map((s) => (
            <article key={s.n} className="lp-step">
              <span className="lp-step-number">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="lp-checkin" aria-labelledby="lp-checkin-title">
        <div className="lp-checkin-intro">
          <h2 id="lp-checkin-title">
            A few simple tasks.
            <br />A fuller picture.
          </h2>
          <p className="lp-checkin-description">
            Memory, speech, and eye movement offer different ways to understand
            change. Each check-in brings those observations together over time.
          </p>
        </div>
        <div className="lp-task-sheet">
          <article className="lp-task">
            <svg
              className="lp-task-art"
              viewBox="0 0 64 48"
              fill="none"
              aria-hidden="true"
            >
              <rect x="7" y="12" width="25" height="30" rx="4" />
              <rect x="23" y="5" width="25" height="30" rx="4" />
              <path d="M30 16h11M30 23h7" />
            </svg>
            <div>
              <h3>Memory</h3>
              <p>Recall words from earlier in the session.</p>
            </div>
          </article>
          <article className="lp-task">
            <svg
              className="lp-task-art"
              viewBox="0 0 64 48"
              fill="none"
              aria-hidden="true"
            >
              <path d="M6 24h5m5-7v14m7-21v28m8-32v36m8-27v18m8-22v26m8-18v10m5-5h3" />
            </svg>
            <div>
              <h3>Speech</h3>
              <p>Read a short passage out loud.</p>
            </div>
          </article>
          <article className="lp-task">
            <svg
              className="lp-task-art"
              viewBox="0 0 64 48"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M7 28c8-23 18 23 28 0s16-10 23-4"
                strokeDasharray="2 5"
              />
              <circle cx="35" cy="28" r="8" />
              <circle cx="35" cy="28" r="2" fill="currentColor" stroke="none" />
            </svg>
            <div>
              <h3>Eye movement</h3>
              <p>Follow a moving target with your eyes.</p>
            </div>
          </article>
        </div>
      </section>
      <section
        className="lp-closing-section"
        aria-labelledby="lp-closing-title"
      >
        <h2 className="lp-closing" id="lp-closing-title">
          Recovery doesn’t stop between appointments. Neither should our
          understanding of it.
        </h2>
      </section>
      <footer className="lp-foot">
        <span>© 2026 Synapshot</span>
      </footer>
    </main>
  );
}
