// Original illustrations for the chooser cards, drawn here so no third-party art
// ships with the app. Cards are cropped to fit the window and carry their title
// along the bottom, so what matters sits in the upper middle of each scene.
// LIBRARY_ART in art.ts replaces them with final artwork.

const SVG_CLASS = "absolute inset-0 h-full w-full";

const SKYLINE =
  "M400 452 V396 h38 v-28 h30 v40 h26 v-74 h22 v-22 h16 v22 h24 v92 h30 v-58 h44 v30 h22 v-96 h14 v-26 h12 v26 h14 v124 h34 v-44 h40 v24 h28 v-84 h34 v84 h30 v-42 h24 v-34 h10 v34 h26 v66 h28 v-30 h42 v46 h22 v-22 h40 V452 Z";

/** An audience in the dark, watching a city at sunset fill the screen. */
export function MovieScene() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMin slice"
      className={SVG_CLASS}
    >
      <defs>
        <linearGradient id="movie-room" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#170d12" />
          <stop offset="0.5" stopColor="#1f1012" />
          <stop offset="1" stopColor="#08060a" />
        </linearGradient>
        <radialGradient id="movie-spill" cx="0.5" cy="0.33" r="0.66">
          <stop offset="0" stopColor="#ff9f5a" stopOpacity="0.5" />
          <stop offset="0.5" stopColor="#b8452f" stopOpacity="0.2" />
          <stop offset="1" stopColor="#b8452f" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="movie-film-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#123a52" />
          <stop offset="0.42" stopColor="#7b5a6b" />
          <stop offset="0.72" stopColor="#f39a5c" />
          <stop offset="1" stopColor="#ffd98f" />
        </linearGradient>
        <radialGradient id="movie-film-sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff6d8" />
          <stop offset="0.3" stopColor="#ffe0a0" stopOpacity="0.9" />
          <stop offset="1" stopColor="#ffb868" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="movie-film-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9794a" />
          <stop offset="1" stopColor="#2a1a2a" />
        </linearGradient>
        <linearGradient id="movie-beam" x1="0" y1="0" x2="1" y2="0.5">
          <stop offset="0" stopColor="#ffe6c2" stopOpacity="0.32" />
          <stop offset="1" stopColor="#ffe6c2" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="movie-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a2c22" stopOpacity="0" />
          <stop offset="0.3" stopColor="#5a2c22" stopOpacity="0.7" />
          <stop offset="1" stopColor="#120a0c" stopOpacity="0" />
        </linearGradient>
        <clipPath id="movie-frame">
          <rect x="400" y="108" width="800" height="396" rx="5" />
        </clipPath>
        <filter id="movie-glow" x="-30%" y="-40%" width="160%" height="180%">
          <feGaussianBlur stdDeviation="52" />
        </filter>
        <filter id="movie-beam-soft" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="12" />
        </filter>
      </defs>

      <rect width="1600" height="1000" fill="url(#movie-room)" />
      <rect width="1600" height="1000" fill="url(#movie-spill)" />

      {/* Walls running towards the screen, with a line of sconces on each. */}
      <path d="M0 0 L372 84 L372 530 L0 760 Z" fill="#ffffff" opacity="0.022" />
      <path d="M1600 0 L1228 84 L1228 530 L1600 760 Z" fill="#ffffff" opacity="0.022" />
      <g fill="#ffcf9c">
        <circle cx="120" cy="238" r="4" opacity="0.8" />
        <circle cx="214" cy="254" r="3.4" opacity="0.65" />
        <circle cx="296" cy="268" r="2.8" opacity="0.5" />
        <circle cx="1480" cy="238" r="4" opacity="0.8" />
        <circle cx="1386" cy="254" r="3.4" opacity="0.65" />
        <circle cx="1304" cy="268" r="2.8" opacity="0.5" />
      </g>

      <rect
        x="380"
        y="100"
        width="840"
        height="420"
        fill="#ff9a58"
        opacity="0.55"
        filter="url(#movie-glow)"
      />

      {/* The projector's beam, reaching down from the booth. */}
      <path
        d="M40 -40 L410 120 L410 492 Z"
        fill="url(#movie-beam)"
        filter="url(#movie-beam-soft)"
      />

      {/* The film on screen, drawn over the end of the beam. */}
      <g clipPath="url(#movie-frame)">
        <rect x="400" y="108" width="800" height="396" fill="url(#movie-film-sky)" />
        <circle cx="880" cy="392" r="150" fill="url(#movie-film-sun)" />
        <path d={SKYLINE} fill="#23141f" />
        <rect x="400" y="452" width="800" height="52" fill="url(#movie-film-water)" />
        <path d="M852 452 h56 l16 52 h-88 Z" fill="#ffe0a0" opacity="0.5" />
        <rect x="400" y="108" width="800" height="44" fill="#050406" />
        <rect x="400" y="462" width="800" height="42" fill="#050406" />
      </g>
      <rect
        x="400"
        y="108"
        width="800"
        height="396"
        rx="5"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.12"
        strokeWidth="2"
      />

      <path d="M0 500 H1600 V760 H0 Z" fill="url(#movie-floor)" />

      {/* The audience, far row then near row. */}
      <g fill="#100a0e">
        <rect y="622" width="1600" height="120" />
        {[110, 236, 362, 488, 614, 740, 866, 992, 1118, 1244, 1370, 1496].map((x, i) => (
          <path
            key={x}
            d={`M${x - 52} 640 q0 -32 28 -32 h48 q28 0 28 32 v8 h-104 Z`}
            opacity={i % 2 ? 1 : 0.92}
          />
        ))}
        <circle cx="488" cy="584" r="27" />
        <circle cx="614" cy="580" r="25" />
        <circle cx="992" cy="584" r="27" />
        <circle cx="1244" cy="582" r="26" />
      </g>
      <g fill="#07050a">
        <rect y="718" width="1600" height="282" />
        {[40, 220, 400, 580, 760, 940, 1120, 1300, 1480].map((x) => (
          <path key={x} d={`M${x - 76} 740 q0 -48 42 -48 h68 q42 0 42 48 v12 h-152 Z`} />
        ))}
        <circle cx="580" cy="642" r="40" />
        <path d="M526 700 q54 -30 108 0 v30 h-108 Z" />
        <circle cx="760" cy="648" r="38" />
        <path d="M710 704 q50 -28 100 0 v30 h-100 Z" />
        <circle cx="1120" cy="646" r="39" />
        <path d="M1068 702 q52 -30 104 0 v30 h-104 Z" />
      </g>
    </svg>
  );
}

/** A lone traveller on a ridge at dusk, with the whole range ahead of them. */
export function GameScene() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1600 1000"
      preserveAspectRatio="xMidYMin slice"
      className={SVG_CLASS}
    >
      <defs>
        <linearGradient id="game-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0a1030" />
          <stop offset="0.28" stopColor="#23286b" />
          <stop offset="0.46" stopColor="#7a3f92" />
          <stop offset="0.6" stopColor="#ea7a62" />
          <stop offset="0.72" stopColor="#ffb878" />
        </linearGradient>
        <radialGradient id="game-glow" cx="0.56" cy="0.47" r="0.46">
          <stop offset="0" stopColor="#ffe3ad" stopOpacity="0.95" />
          <stop offset="0.35" stopColor="#ff9c70" stopOpacity="0.42" />
          <stop offset="1" stopColor="#f47f6b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="game-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#8a4a93" />
          <stop offset="1" stopColor="#4d3180" />
        </linearGradient>
        <linearGradient id="game-mid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#40306f" />
          <stop offset="1" stopColor="#201f55" />
        </linearGradient>
        <linearGradient id="game-near" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b1a46" />
          <stop offset="1" stopColor="#0c0d26" />
        </linearGradient>
        <linearGradient id="game-ridge" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0b0b1f" />
          <stop offset="1" stopColor="#04050d" />
        </linearGradient>
        <filter id="game-haze" x="-10%" y="-60%" width="120%" height="220%">
          <feGaussianBlur stdDeviation="30" />
        </filter>
      </defs>

      <rect width="1600" height="1000" fill="url(#game-sky)" />
      <rect width="1600" height="1000" fill="url(#game-glow)" />

      <g fill="#fff">
        <circle cx="180" cy="86" r="2" opacity="0.8" />
        <circle cx="320" cy="150" r="1.5" opacity="0.6" />
        <circle cx="470" cy="60" r="2.2" opacity="0.9" />
        <circle cx="610" cy="130" r="1.4" opacity="0.5" />
        <circle cx="760" cy="52" r="1.8" opacity="0.7" />
        <circle cx="905" cy="112" r="1.5" opacity="0.6" />
        <circle cx="1060" cy="70" r="2" opacity="0.8" />
        <circle cx="1230" cy="130" r="1.4" opacity="0.5" />
        <circle cx="1390" cy="64" r="2.2" opacity="0.9" />
        <circle cx="1510" cy="150" r="1.6" opacity="0.6" />
        <circle cx="96" cy="200" r="1.4" opacity="0.5" />
        <circle cx="1310" cy="210" r="1.2" opacity="0.4" />
      </g>

      <circle cx="900" cy="462" r="112" fill="#fff0c8" />

      {/* Birds, far off against the glow. */}
      <g fill="none" stroke="#2a1a3a" strokeWidth="3" strokeLinecap="round" opacity="0.7">
        <path d="M672 318 q10 -10 18 0 q8 -10 18 0" />
        <path d="M728 288 q7 -7 13 0 q6 -7 13 0" />
        <path d="M640 276 q6 -6 11 0 q5 -6 11 0" />
      </g>

      <path
        d="M0 610 L150 520 L260 572 L392 462 L506 548 L610 490 L742 578 L860 520 L980 596 L1120 482 L1244 566 L1372 500 L1490 572 L1600 520 V1000 H0 Z"
        fill="url(#game-far)"
      />
      <rect
        y="560"
        width="1600"
        height="70"
        fill="#ffae80"
        opacity="0.32"
        filter="url(#game-haze)"
      />
      <path
        d="M0 684 L128 596 L272 662 L432 566 L568 660 L704 610 L864 692 L1014 620 L1168 690 L1308 600 L1456 672 L1600 610 V1000 H0 Z"
        fill="url(#game-mid)"
      />
      <rect
        y="660"
        width="1600"
        height="60"
        fill="#c06a8a"
        opacity="0.2"
        filter="url(#game-haze)"
      />
      <path
        d="M0 762 L184 682 L360 752 L524 696 L700 772 L904 716 L1084 784 L1284 706 L1444 766 L1600 716 V1000 H0 Z"
        fill="url(#game-near)"
      />

      {/* The ridge in the foreground, and the traveller on its crest. */}
      <path
        d="M0 880 C180 846 340 790 500 742 C600 712 700 660 800 622 C850 603 900 596 950 604 C1030 618 1110 672 1220 716 C1360 772 1490 800 1600 812 V1000 H0 Z"
        fill="url(#game-ridge)"
      />
      <g fill="#04050d">
        <circle cx="889" cy="490" r="16" />
        <path d="M870 512 q19 -10 38 0 l9 56 h-11 l-3 44 h-13 l-2 -36 l-3 36 h-13 l-2 -44 h-11 Z" />
        <path d="M870 516 q-24 34 -40 96 q22 -16 42 -22 Z" />
        <path d="M908 522 l32 -22 l5 6 l-34 28 Z" />
        <rect x="942" y="442" width="5" height="172" rx="2.5" transform="rotate(3 944 528)" />
      </g>
    </svg>
  );
}
