// An original kitchen scene, drawn here in code.
//
// The classic picture description tests are copyrighted, so this is our own drawing. It is
// built to give a patient plenty to say: people doing things, something going wrong, animals,
// objects, a window with weather, and a few small details in the corners.

export const KITCHEN_THINGS = [
  "a tap left running and the sink overflowing",
  "a man drying a plate and not noticing the water",
  "a child on a stool reaching for a biscuit jar",
  "a cat watching the fish bowl on the shelf",
  "a dog waiting by an empty bowl",
  "a kettle steaming on the stove",
  "a cake on the table with one slice taken",
  "a broken cup on the floor",
  "rain on the window and a bird on the fence",
  "a clock showing ten past four",
];

/** The scene. Pure SVG, no images, no external fonts, scales to any width. */
export function Kitchen({ title = "A kitchen" }: { title?: string }) {
  return (
    <svg
      viewBox="0 0 400 300"
      className="h-auto w-full rounded-2xl border border-border bg-card"
      role="img"
      aria-label={`${title}. ${KITCHEN_THINGS.join(", ")}.`}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id="kitchen-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#bcd3de" />
          <stop offset="100%" stopColor="#e3eef1" />
        </linearGradient>
      </defs>

      {/* walls and floor */}
      <rect x="0" y="0" width="400" height="215" fill="#eef2ef" />
      <rect x="0" y="215" width="400" height="85" fill="#d7c7b3" />
      <path d="M0 215 L400 215" stroke="#bda98f" strokeWidth="2" />
      {Array.from({ length: 9 }, (_, i) => (
        <path key={`floor-${i}`} d={`M${i * 50} 300 L${120 + i * 32} 215`} stroke="#c9b69f" strokeWidth="1" />
      ))}

      {/* window with rain, a tree and a bird on the fence */}
      <rect x="236" y="34" width="118" height="86" rx="4" fill="url(#kitchen-sky)" stroke="#8fa3ab" strokeWidth="3" />
      <path d="M295 34 V120 M236 77 H354" stroke="#8fa3ab" strokeWidth="3" />
      <circle cx="268" cy="62" r="13" fill="#8fb98c" />
      <rect x="266" y="62" width="4" height="14" fill="#7d6a52" />
      <path d="M236 104 H354" stroke="#9a8b6f" strokeWidth="3" />
      <path d="M322 104 v-8 M330 104 v-8 M338 104 v-8" stroke="#9a8b6f" strokeWidth="2" />
      <ellipse cx="330" cy="93" rx="6" ry="4" fill="#5b6f7a" />
      <path d="M336 92 l6 -2" stroke="#5b6f7a" strokeWidth="2" />
      {Array.from({ length: 10 }, (_, i) => (
        <path
          key={`rain-${i}`}
          d={`M${242 + i * 11} ${40 + (i % 3) * 9} l-4 10`}
          stroke="#9fb9c4"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      ))}

      {/* clock at ten past four */}
      <circle cx="188" cy="48" r="20" fill="#fdfbf6" stroke="#6e6257" strokeWidth="3" />
      <path d="M188 48 V36" stroke="#3c3732" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M188 48 l10 4" stroke="#3c3732" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="188" cy="48" r="2" fill="#3c3732" />

      {/* shelf with a fish bowl and a biscuit jar */}
      <rect x="20" y="62" width="104" height="7" rx="2" fill="#a98f6f" />
      <path d="M44 62 a14 14 0 0 1 28 0 Z" fill="#cfe6ee" stroke="#8fa3ab" strokeWidth="2" />
      <circle cx="58" cy="54" r="3" fill="#e09a57" />
      <rect x="86" y="36" width="26" height="26" rx="4" fill="#f0e2c6" stroke="#b79b6d" strokeWidth="2" />
      <rect x="84" y="31" width="30" height="6" rx="3" fill="#b79b6d" />
      <circle cx="93" cy="49" r="2.4" fill="#a6763f" />
      <circle cx="101" cy="52" r="2.4" fill="#a6763f" />

      {/* counter, sink overflowing, running tap */}
      <rect x="14" y="134" width="176" height="14" rx="3" fill="#b9a183" />
      <rect x="20" y="148" width="164" height="67" fill="#e5dbcb" stroke="#c6b49a" strokeWidth="2" />
      <rect x="54" y="138" width="70" height="8" fill="#9fa6a8" />
      <rect x="58" y="113" width="6" height="25" fill="#9fa6a8" />
      <path d="M58 113 h26 v12" stroke="#9fa6a8" strokeWidth="6" fill="none" strokeLinecap="round" />
      <path d="M84 126 v16" stroke="#7fb6cc" strokeWidth="4" strokeLinecap="round" />
      <path d="M58 146 q14 10 32 8 q18 -2 30 8" stroke="#7fb6cc" strokeWidth="3" fill="none" />
      <path d="M62 150 l-5 24 M74 152 l-3 22 M110 152 l5 22" stroke="#7fb6cc" strokeWidth="2.4" strokeLinecap="round" />
      <ellipse cx="86" cy="222" rx="38" ry="7" fill="#9fcbdd" opacity="0.8" />

      {/* stove with a steaming kettle */}
      <rect x="196" y="148" width="60" height="67" fill="#d9d2c6" stroke="#bbb1a1" strokeWidth="2" />
      <rect x="196" y="134" width="60" height="14" rx="3" fill="#8d8579" />
      <circle cx="226" cy="141" r="5" fill="#5f5a52" />
      <path d="M212 134 q4 -14 14 -14 q10 0 14 14 Z" fill="#c25f4b" stroke="#8f4132" strokeWidth="2" />
      <path d="M240 126 q8 -2 8 6" stroke="#8f4132" strokeWidth="2.4" fill="none" />
      <path d="M226 118 q-7 -9 0 -16 q7 -7 0 -14" stroke="#b9c7cc" strokeWidth="2.6" fill="none" strokeLinecap="round" />

      {/* the man at the sink, drying a plate, not looking at the water */}
      <circle cx="150" cy="104" r="15" fill="#e8c49c" stroke="#c49a6c" strokeWidth="2" />
      <path d="M136 100 q14 -12 28 0" fill="#5c4733" />
      <circle cx="145" cy="105" r="1.8" fill="#3c3732" />
      <circle cx="156" cy="105" r="1.8" fill="#3c3732" />
      <path d="M145 113 q5 4 10 0" stroke="#3c3732" strokeWidth="1.6" fill="none" />
      <path d="M150 119 q-22 6 -22 40 v56 h44 v-56 q0 -34 -22 -40 Z" fill="#6f8fa6" stroke="#4f6c80" strokeWidth="2" />
      <path d="M130 136 q-18 14 -8 30" stroke="#6f8fa6" strokeWidth="9" fill="none" strokeLinecap="round" />
      <circle cx="124" cy="168" r="14" fill="#fdfbf6" stroke="#c6b49a" strokeWidth="2" />
      <path d="M170 136 q18 10 12 26" stroke="#6f8fa6" strokeWidth="9" fill="none" strokeLinecap="round" />
      <path d="M176 162 q10 6 4 16" stroke="#f2ead9" strokeWidth="6" fill="none" strokeLinecap="round" />

      {/* the child on a stool reaching for the jar */}
      <rect x="92" y="196" width="30" height="6" rx="2" fill="#a98f6f" />
      <path d="M95 202 v18 M119 202 v18" stroke="#a98f6f" strokeWidth="5" strokeLinecap="round" />
      <circle cx="104" cy="104" r="11" fill="#eccfae" stroke="#c49a6c" strokeWidth="2" />
      <path d="M93 102 q11 -11 22 0" fill="#8a5a3b" />
      <circle cx="100" cy="105" r="1.5" fill="#3c3732" />
      <circle cx="108" cy="105" r="1.5" fill="#3c3732" />
      <path d="M104 115 q-14 5 -14 30 v51 h28 v-51 q0 -25 -14 -30 Z" fill="#d9a05b" stroke="#b07c3c" strokeWidth="2" />
      <path d="M94 128 q-12 -20 -4 -36" stroke="#d9a05b" strokeWidth="8" fill="none" strokeLinecap="round" />
      <circle cx="90" cy="90" r="5" fill="#eccfae" />

      {/* table with a cake, a taken slice and a broken cup on the floor */}
      <rect x="258" y="196" width="128" height="9" rx="3" fill="#b07c3c" />
      <path d="M268 205 v62 M376 205 v62" stroke="#8e6430" strokeWidth="7" strokeLinecap="round" />
      <path d="M300 196 q22 -26 44 0 Z" fill="#f4dcc0" stroke="#c99e6a" strokeWidth="2" />
      <path d="M300 196 q22 -26 44 0" fill="none" stroke="#c0693f" strokeWidth="3" />
      <path d="M352 196 q8 -12 16 0 Z" fill="#f4dcc0" stroke="#c99e6a" strokeWidth="2" />
      <path d="M284 262 q10 -12 20 0 Z" fill="#fdfbf6" stroke="#b7a68e" strokeWidth="2" />
      <path d="M306 258 l10 6 M312 252 l8 4" stroke="#b7a68e" strokeWidth="2" strokeLinecap="round" />

      {/* the cat on the counter and the dog by an empty bowl */}
      <path d="M160 134 q14 -4 22 0 q6 -12 10 0 q4 -12 8 0 l-2 10 h-38 Z" fill="#8d8579" />
      <circle cx="166" cy="128" r="2" fill="#3c3732" />
      <path d="M36 268 q16 -24 38 -20 q18 4 18 20 Z" fill="#c18a52" stroke="#9a6a38" strokeWidth="2" />
      <circle cx="34" cy="252" r="12" fill="#c18a52" stroke="#9a6a38" strokeWidth="2" />
      <path d="M24 244 q-4 -10 4 -8" stroke="#9a6a38" strokeWidth="3" fill="none" />
      <circle cx="30" cy="251" r="1.8" fill="#3c3732" />
      <path d="M88 266 q10 -2 20 0 l-3 8 h-14 Z" fill="#7fa6b8" stroke="#55808f" strokeWidth="2" />
    </svg>
  );
}
