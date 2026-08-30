/* 路线 A · SVG 手绘矢量
 * 分层路径 + 渐变 + feTurbulence 墨边。矢量直接内联，接入时可 canvas 光栅化烘焙成纹理。
 * viewBox 120x140，脚底 y≈126。 */

function svgDefs(uid, washColor) {
  return `
  <defs>
    <radialGradient id="wash-${uid}" cx="50%" cy="55%" r="55%">
      <stop offset="0%" stop-color="${washColor}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${washColor}" stop-opacity="0"/>
    </radialGradient>
    <filter id="ink-${uid}" x="-12%" y="-12%" width="124%" height="124%">
      <feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="2" seed="11" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/>
    </filter>
    <filter id="soft-${uid}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.6"/>
    </filter>
  </defs>`;
}

const SHADOW = (cx, rx) =>
  `<ellipse cx="${cx}" cy="127" rx="${rx}" ry="6" fill="#000" opacity="0.4" filter="url(#soft-SHARED)"/>`;

function wrap(uid, washColor, inner, W = 170, H = 198) {
  return `<svg width="${W}" height="${H}" viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg">
    ${svgDefs(uid, washColor)}
    <circle cx="60" cy="82" r="56" fill="url(#wash-${uid})"/>
    <g filter="url(#ink-${uid})">${inner}</g>
  </svg>`;
}

/* ── 断岳 · 墨刀卫：重甲刀卫，扛长刀 ── */
function svgWarrior() {
  const inner = `
    ${SHADOW(62, 30).replace('SHARED', 'w1')}
    <!-- 长刀（背后） -->
    <line x1="33" y1="124" x2="76" y2="33" stroke="#3b414d" stroke-width="4.6" stroke-linecap="round"/>
    <line x1="33" y1="124" x2="76" y2="33" stroke="#20242c" stroke-width="1.4" opacity="0.6"/>
    <path d="M74,42 Q90,26 96,7 Q80,19 63,31 Z" fill="url(#steelW)" stroke="#191d24" stroke-width="1.6"/>
    <path d="M74,42 Q88,27 93,14" fill="none" stroke="#aab4c4" stroke-width="1.1" opacity="0.8"/>
    <!-- 腿与靴 -->
    <path d="M47,126 L45,106 L57,104 L58,126 Z" fill="#23262e" stroke="#15171c" stroke-width="1.4"/>
    <path d="M63,126 L64,104 L76,106 L74,126 Z" fill="#23262e" stroke="#15171c" stroke-width="1.4"/>
    <path d="M45,104 L57,102 L58,110 L46,112 Z" fill="#2f343f"/>
    <path d="M64,102 L76,104 L75,112 L63,110 Z" fill="#282c35"/>
    <!-- 战裙 -->
    <path d="M42,108 L44,90 L76,90 L78,108 L68,113 L52,113 Z" fill="#3a4150" stroke="#191d24" stroke-width="1.6"/>
    <path d="M52,111 L50,94 L70,94 L68,111 Z" fill="#454d5e"/>
    <path d="M50,94 L70,94 L69,99 L51,99 Z" fill="#565f72" opacity="0.8"/>
    <!-- 躯干 -->
    <path d="M44,94 L46,66 Q60,57 74,66 L76,94 Z" fill="url(#armor-w2)" stroke="#191d24" stroke-width="1.6"/>
    <path d="M48,72 Q60,66 72,72" fill="none" stroke="#20242c" stroke-width="1.2" opacity="0.7"/>
    <path d="M47,82 Q60,76 73,82" fill="none" stroke="#20242c" stroke-width="1.2" opacity="0.7"/>
    <path d="M47,68 Q54,64 58,64 L52,92 L47,92 Z" fill="#5a6376" opacity="0.45"/>
    <!-- 朱砂束带 -->
    <path d="M46,67 L59,93" stroke="#7d3a30" stroke-width="5.5" stroke-linecap="round" opacity="0.92"/>
    <path d="M55,86 L61,97 L56,99 Z" fill="#8a4034"/>
    <!-- 护肩 -->
    <path d="M40,69 Q35,56 48,51 Q57,49 59,57 L57,68 Q48,73 40,69 Z" fill="#565f72" stroke="#191d24" stroke-width="1.6"/>
    <path d="M80,69 Q85,56 72,51 Q63,49 61,57 L63,68 Q72,73 80,69 Z" fill="#454d5e" stroke="#191d24" stroke-width="1.6"/>
    <path d="M42,58 Q48,53 55,55" fill="none" stroke="#8a93a5" stroke-width="1.2" opacity="0.85"/>
    <!-- 左臂扶腰 -->
    <path d="M40,70 L37,88 L48,91 L51,73 Z" fill="#333947" stroke="#191d24" stroke-width="1.5"/>
    <circle cx="43" cy="91" r="5.2" fill="#c9b696" stroke="#191d24" stroke-width="1.4"/>
    <!-- 右臂扶刀柄 -->
    <path d="M61,58 Q70,52 74,45 L82,49 Q76,60 65,68 Z" fill="#3d4452" stroke="#191d24" stroke-width="1.5"/>
    <circle cx="75" cy="44" r="5" fill="#c9b696" stroke="#191d24" stroke-width="1.4"/>
    <!-- 头盔 -->
    <path d="M50,53 Q49,37 60,36 Q71,37 70,53 L66,58 L54,58 Z" fill="#4a5262" stroke="#191d24" stroke-width="1.6"/>
    <rect x="53.5" y="46" width="13" height="2.8" fill="#101319"/>
    <path d="M51,42 Q54,38 60,37" fill="none" stroke="#8a93a5" stroke-width="1.1" opacity="0.8"/>
    <path d="M60,36 Q57,27 67,22 Q64,31 62,36 Z" fill="#7d3a30" stroke="#191d24" stroke-width="1.3"/>
    <path d="M62,36 Q66,31 72,30 Q68,36 64,38 Z" fill="#6a2f26"/>
    <!-- 刀穗 -->
    <path d="M76,36 L81,48 M79,35 L84,45" stroke="#8a4034" stroke-width="1.3" opacity="0.85"/>
  `;
  return wrap('warrior', '#5a6c8a', inner).replace('steel-w2', 'steelW').replace('armor-w2', 'armorW')
    + `<svg width="0" height="0"><defs>
      <linearGradient id="steelW" x1="0" y1="1" x2="1" y2="0">
        <stop offset="0%" stop-color="#6b7688"/><stop offset="55%" stop-color="#9aa6b8"/><stop offset="100%" stop-color="#c9d3e0"/>
      </linearGradient>
      <linearGradient id="armorW" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#4d5666"/><stop offset="100%" stop-color="#30363f"/>
      </linearGradient>
    </defs></svg>`;
}

/* ── 磐 · 石灵：蹲踞巨岩 ── */
function svgGolem() {
  const inner = `
    ${SHADOW(60, 36).replace('SHARED', 'g1')}
    <!-- 碎石 -->
    <path d="M14,120 L20,110 L28,116 L26,124 L16,124 Z" fill="#4a505a" stroke="#20242a" stroke-width="1.3"/>
    <path d="M96,122 L101,114 L108,119 L106,125 L98,125 Z" fill="#454b55" stroke="#20242a" stroke-width="1.3"/>
    <!-- 躯干巨岩 -->
    <path d="M28,118 Q18,96 30,74 Q36,56 58,52 Q80,50 88,68 Q98,84 92,104 Q90,120 74,124 L42,124 Q31,122 28,118 Z"
      fill="url(#stoneG)" stroke="#20242a" stroke-width="1.8"/>
    <!-- 裂纹 -->
    <path d="M52,72 L58,86 L54,98" fill="none" stroke="#262b32" stroke-width="1.4"/>
    <path d="M70,64 L66,78 L72,90" fill="none" stroke="#262b32" stroke-width="1.2"/>
    <path d="M38,94 Q45,100 43,110" fill="none" stroke="#262b32" stroke-width="1.2"/>
    <!-- 受光面 -->
    <path d="M34,72 Q40,58 56,54" fill="none" stroke="#8d96a3" stroke-width="1.6" opacity="0.55"/>
    <path d="M30,92 Q28,80 34,70" fill="none" stroke="#8d96a3" stroke-width="1.3" opacity="0.4"/>
    <!-- 左臂（拄地巨拳） -->
    <path d="M30,86 Q16,92 19,106 Q23,119 39,116 L47,110 Q42,94 34,86 Z" fill="#565d68" stroke="#20242a" stroke-width="1.7"/>
    <path d="M24,108 Q28,114 38,113" fill="none" stroke="#2a2f36" stroke-width="1.3"/>
    <!-- 右臂（微抬） -->
    <path d="M90,84 Q102,88 101,101 Q98,113 85,112 L78,107 Q82,93 86,85 Z" fill="#4a505a" stroke="#20242a" stroke-width="1.7"/>
    <path d="M82,106 Q88,110 96,107" fill="none" stroke="#2a2f36" stroke-width="1.2"/>
    <!-- 头（嵌岩） -->
    <path d="M48,60 Q45,45 58,43 Q71,44 70,58 Q64,67 53,66 Z" fill="#767e8c" stroke="#20242a" stroke-width="1.6"/>
    <path d="M50,50 Q52,46 58,45" fill="none" stroke="#9aa4b0" stroke-width="1.2" opacity="0.7"/>
    <!-- 琥珀目 -->
    <rect x="51.5" y="51" width="7.5" height="3" rx="1.2" fill="#e8b34a" transform="rotate(-4 55 52.5)"/>
    <rect x="61.5" y="51" width="7.5" height="3" rx="1.2" fill="#e8b34a" transform="rotate(4 65 52.5)"/>
    <rect x="52.2" y="51.5" width="6" height="1.8" rx="0.9" fill="#f7dfa0" transform="rotate(-4 55 52.5)"/>
    <rect x="62.2" y="51.5" width="6" height="1.8" rx="0.9" fill="#f7dfa0" transform="rotate(4 65 52.5)"/>
    <!-- 苔衣 -->
    <path d="M46,45 Q52,41 60,42 Q56,47 50,47 Z" fill="#5a7050" opacity="0.9"/>
    <path d="M34,74 Q42,68 52,68 Q44,76 36,78 Z" fill="#4e6448" opacity="0.85"/>
    <path d="M70,60 Q78,58 82,62 Q76,66 70,64 Z" fill="#5a7050" opacity="0.8"/>
    <path d="M24,98 Q30,94 34,96 Q30,101 26,101 Z" fill="#4e6448" opacity="0.75"/>
  `;
  return wrap('golem', '#5c7a5e', inner).replace('stone-g2', 'stoneG')
    + `<svg width="0" height="0"><defs>
      <linearGradient id="stoneG" x1="0" y1="0" x2="0.7" y2="1">
        <stop offset="0%" stop-color="#78808e"/><stop offset="60%" stop-color="#565d68"/><stop offset="100%" stop-color="#42474f"/>
      </linearGradient>
    </defs></svg>`;
}

/* ── 朱炎 · 毕方：鹤面火祝 ── */
function svgMage() {
  const inner = `
    ${SHADOW(58, 27).replace('SHARED', 'm1')}
    <!-- 火羽坠屑 -->
    <circle cx="94" cy="14" r="1.6" fill="#e8a34a" opacity="0.85"/>
    <circle cx="99" cy="26" r="1.2" fill="#d97b34" opacity="0.7"/>
    <circle cx="90" cy="38" r="1" fill="#e8a34a" opacity="0.5"/>
    <!-- 长袍 -->
    <path d="M46,124 L41,121 Q37,96 43,72 Q45,56 51,45 L69,45 Q76,56 78,74 Q83,98 79,121 L74,124 Q60,129 46,124 Z"
      fill="url(#robe-m2)" stroke="#15171d" stroke-width="1.7"/>
    <!-- 前襟朱里 -->
    <path d="M56,120 Q52,92 56,64 L64,64 Q68,92 64,120 Z" fill="#7d2f24" stroke="#15171d" stroke-width="1.2"/>
    <path d="M56,64 L64,64 L63.4,70 L56.6,70 Z" fill="#9a3c2c"/>
    <path d="M57,78 L63,78 M56,92 L64,92" stroke="#5a2018" stroke-width="1.1"/>
    <!-- 左垂袖 -->
    <path d="M45,56 Q37,66 39,82 L50,86 Q52,70 55,59 Z" fill="#2b2f3a" stroke="#15171d" stroke-width="1.5"/>
    <path d="M39,82 L50,86 L49,90 L38,86 Z" fill="#6a2f26"/>
    <!-- 右臂扬袖（执火） -->
    <path d="M66,54 Q78,45 84,33 L93,38 Q88,53 76,63 Z" fill="#2b2f3a" stroke="#15171d" stroke-width="1.5"/>
    <path d="M84,33 L93,38 L91,42 L82,37 Z" fill="#6a2f26"/>
    <circle cx="89" cy="33" r="4.4" fill="#cbb89a" stroke="#15171d" stroke-width="1.3"/>
    <!-- 火团 -->
    <path d="M89,30 Q79,17 88,2 Q98,15 89,30 Z" fill="url(#fire-m2)"/>
    <path d="M89,24 Q85,17 89,9 Q93,17 89,24 Z" fill="#f7e3a0" opacity="0.9"/>
    <circle cx="93" cy="4" r="1.2" fill="#f2c14a" opacity="0.8"/>
    <circle cx="82" cy="10" r="1" fill="#e8722e" opacity="0.8"/>
    <!-- 羽翎肩披 -->
    <path d="M46,50 Q40,56 40,64 L48,66 Q48,57 52,52 Z" fill="#3a3f4c" stroke="#15171d" stroke-width="1.3"/>
    <path d="M74,50 Q80,56 80,64 L72,66 Q72,57 68,52 Z" fill="#3a3f4c" stroke="#15171d" stroke-width="1.3"/>
    <path d="M40,64 L48,66 L47,69 L40,67 Z" fill="#8a3226"/>
    <path d="M80,64 L72,66 L73,69 L80,67 Z" fill="#8a3226"/>
    <!-- 兜帽 + 鹤喙面 -->
    <path d="M49,40 Q48,24 61,23 Q74,24 73,40 Q67,48 56,47 Z" fill="#262a33" stroke="#15171d" stroke-width="1.6"/>
    <path d="M60,35 L86,41 L60,45 Z" fill="#cfc3a6" stroke="#15171d" stroke-width="1.2"/>
    <circle cx="80" cy="40" r="0.9" fill="#8a7f6a"/>
    <path d="M58,33 L63,35 L58,37 Z" fill="#e8b34a"/>
    <path d="M49,30 Q46,22 52,16 Q52,26 54,30 Z" fill="#8a3226" stroke="#15171d" stroke-width="1"/>
    <path d="M54,29 Q56,20 62,17 Q59,26 58,30 Z" fill="#6a2f26" stroke="#15171d" stroke-width="1"/>
    <!-- 腰绦 -->
    <path d="M50,86 L50,122 M70,86 L70,122" stroke="#3a3f4c" stroke-width="1.2" opacity="0.6"/>
    <circle cx="60" cy="98" r="2" fill="#c9a96a"/>
  `;
  return wrap('mage', '#b06a3a', inner).replace('robe-m2', 'robeM').replace('fire-m2', 'fireM')
    + `<svg width="0" height="0"><defs>
      <linearGradient id="robeM" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#31353f"/><stop offset="100%" stop-color="#1c1f27"/>
      </linearGradient>
      <linearGradient id="fireM" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0%" stop-color="#e8722e" stop-opacity="0.1"/>
        <stop offset="45%" stop-color="#e8722e"/>
        <stop offset="100%" stop-color="#f2c14a"/>
      </linearGradient>
    </defs></svg>`;
}

/* ── 惊羽 · 弓手：侧身引弓 ── */
function svgArcher() {
  const inner = `
    ${SHADOW(60, 26).replace('SHARED', 'a1')}
    <!-- 大弓（身后立） -->
    <path d="M34,122 Q18,80 34,30" fill="none" stroke="#4a4034" stroke-width="3.6" stroke-linecap="round"/>
    <path d="M34,122 Q18,80 34,30" fill="none" stroke="#2e2820" stroke-width="1.2" opacity="0.6"/>
    <line x1="34" y1="122" x2="34" y2="30" stroke="#c9b696" stroke-width="0.9" opacity="0.65"/>
    <!-- 箭（搭弦） -->
    <line x1="30" y1="76" x2="74" y2="76" stroke="#8a7a5c" stroke-width="1.8"/>
    <path d="M74,76 L82,76 L74,72.5 L74,79.5 Z" fill="#aab4c4" stroke="#191d24" stroke-width="0.8"/>
    <path d="M31,73 L37,76 L31,79 Z" fill="#7d6a4a"/>
    <!-- 腿 -->
    <path d="M50,126 L48,108 L59,106 L60,126 Z" fill="#2e3428" stroke="#15171c" stroke-width="1.4"/>
    <path d="M62,126 L63,106 L73,108 L71,126 Z" fill="#39412f" stroke="#15171c" stroke-width="1.4"/>
    <!-- 猎装下摆 -->
    <path d="M46,108 L48,88 L72,88 L74,108 L64,113 L54,113 Z" fill="#4a5238" stroke="#191d24" stroke-width="1.5"/>
    <path d="M48,92 L72,92 L71,96 L49,96 Z" fill="#5a6444" opacity="0.8"/>
    <!-- 躯干（侧身） -->
    <path d="M48,90 L50,64 Q60,57 70,64 L72,90 Z" fill="url(#cloth-a2)" stroke="#191d24" stroke-width="1.5"/>
    <path d="M50,64 L70,64 L68,70 L52,70 Z" fill="#5a6444"/>
    <!-- 皮甲带 -->
    <path d="M52,66 L60,88" stroke="#6a4a30" stroke-width="4" stroke-linecap="round"/>
    <rect x="54" y="74" width="6" height="5" fill="#8a6a3a" stroke="#191d24" stroke-width="0.9" transform="rotate(18 57 76)"/>
    <!-- 箭袋（背后） -->
    <path d="M66,92 L64,76 L74,74 L77,90 Z" fill="#5a4430" stroke="#191d24" stroke-width="1.3"/>
    <line x1="68" y1="74" x2="67" y2="66" stroke="#8a7a5c" stroke-width="1.2"/>
    <line x1="72" y1="74" x2="73" y2="65" stroke="#8a7a5c" stroke-width="1.2"/>
    <path d="M67,65 L66,61 L69,64 Z M73,64 L74,60 L76,64 Z" fill="#c9b696"/>
    <!-- 左臂持弓 -->
    <path d="M50,66 Q40,70 36,76 L42,82 Q48,76 54,74 Z" fill="#4a5238" stroke="#191d24" stroke-width="1.4"/>
    <path d="M32,72 Q30,76 31,80 L37,80 Q36,76 37,73 Z" fill="#4a4034" stroke="#191d24" stroke-width="1"/>
    <!-- 右臂勾弦 -->
    <path d="M70,66 Q76,70 78,76 L71,80 Q68,74 64,72 Z" fill="#44503a" stroke="#191d24" stroke-width="1.4"/>
    <circle cx="33" cy="78" r="3.6" fill="#c9b696" stroke="#191d24" stroke-width="1"/>
    <!-- 头（束发+斗笠带） -->
    <path d="M52,58 Q52,46 61,45 Q70,46 70,58 Q66,64 56,64 Z" fill="#d8c8b0" stroke="#191d24" stroke-width="1.4"/>
    <path d="M52,52 Q56,49 61,49 Q66,49 70,52 L70,48 Q64,44 56,46 Q52,48 52,52 Z" fill="#2e2a24"/>
    <circle cx="57.5" cy="55" r="1.1" fill="#20242c"/>
    <path d="M65,55 Q67,54 68,55" fill="none" stroke="#20242c" stroke-width="1"/>
    <path d="M61,45 Q62,40 68,38 Q65,42 65,45 Z" fill="#2e2a24"/>
    <path d="M66,60 Q69,61 70,60" fill="none" stroke="#8a6a5a" stroke-width="1" opacity="0.7"/>
    <!-- 翎羽 -->
    <path d="M52,48 Q44,42 40,32 Q50,36 54,44 Z" fill="#7d8a5a" stroke="#191d24" stroke-width="1"/>
  `;
  return wrap('archer', '#6a7a4a', inner).replace('cloth-a2', 'clothA')
    + `<svg width="0" height="0"><defs>
      <linearGradient id="clothA" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#525c3e"/><stop offset="100%" stop-color="#38402c"/>
      </linearGradient>
    </defs></svg>`;
}

window.SVG_UNITS = {
  duanyue: { name: '断岳', title: '墨刀卫', render: svgWarrior },
  pan:     { name: '磐',   title: '石灵',   render: svgGolem },
  zhuyan:  { name: '朱炎', title: '毕方',   render: svgMage },
  jingyu:  { name: '惊羽', title: '弓手',   render: svgArcher },
};
