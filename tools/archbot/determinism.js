// Deterministic stand-ins for the only engine- and locale-dependent operations in
// the Stage 5B core. build-core.mjs injects them when it bundles the pinned source;
// nothing about the decision procedure changes.
//
// WHY. JavaScript does not specify Math.exp / Math.log / Math.log1p to the last
// bit, nor String#localeCompare's order (it follows the user's locale). Measured:
//
//   • Node 20, 22, 23 and 26 return identical exp/log/log1p (V8's fdlibm port),
//     but Chromium 151 differs from them on ~10% / 7% / 5% of inputs by one ulp.
//   • Under a Thai locale, localeCompare orders the tile-kind strings differently
//     from the root collation the production service (Node in Docker, no LANG) uses.
//
// Either difference can move a near-tie. So ArchBot computes both exactly as the
// production runtime does, in every browser and every locale:
//
//   • exp, log, log1p: a line-for-line JavaScript port of the FreeBSD msun /
//     fdlibm routines V8 ships (src/base/ieee754.cc), using only IEEE-754 double
//     arithmetic, which JavaScript does specify exactly.
//   • compare: ICU root collation over the finite set of strings the core ever
//     compares (tile kinds and faces), as a fixed rank table.
//
// tests/archbot-determinism.test.ts proves both identical to the production
// runtime's (Node) results; the parity corpus proves the decisions unchanged.

const buffer = new ArrayBuffer(8);
const f64 = new Float64Array(buffer);
const u32 = new Uint32Array(buffer);
// Little-endian: word 1 is the high word. Every browser engine that runs
// EQ-Lab is little-endian; checked once so a big-endian host fails loudly.
f64[0] = 1;
if (u32[1] !== 0x3ff00000) throw new Error("ArchBot determinism: unexpected byte order");

const highWord = (x) => {
  f64[0] = x;
  return u32[1] | 0;
};
const lowWord = (x) => {
  f64[0] = x;
  return u32[0] >>> 0;
};
const withHighWord = (x, high) => {
  f64[0] = x;
  u32[1] = high >>> 0;
  return f64[0];
};
const fromWords = (high, low) => {
  u32[1] = high >>> 0;
  u32[0] = low >>> 0;
  return f64[0];
};

// ── exp (msun e_exp.c, as in V8 ieee754::exp) ────────────────────────────────

const halF = [0.5, -0.5];
const o_threshold = 7.09782712893383973096e2;
const u_threshold = -7.4513321910194110842e2;
const ln2HI = [6.9314718036912381649e-1, -6.9314718036912381649e-1];
const ln2LO = [1.90821492927058770002e-10, -1.90821492927058770002e-10];
const invln2 = 1.442695040888963387;
const P1 = 1.66666666666666019037e-1;
const P2 = -2.77777777770155933842e-3;
const P3 = 6.61375632143793436117e-5;
const P4 = -1.6533902205465251539e-6;
const P5 = 4.13813679705723846039e-8;
const E = 2.718281828459045;
const huge = 1.0e300;
const twom1000 = 9.3326361850321887899e-302;
const two1023 = 8.988465674311579539e307;

function exp(x) {
  let hi = 0;
  let lo = 0;
  let k = 0;
  let hx = highWord(x);
  const xsb = (hx >>> 31) & 1;
  hx &= 0x7fffffff;

  if (hx >= 0x40862e42) {
    if (hx >= 0x7ff00000) {
      if (((hx & 0xfffff) | lowWord(x)) !== 0) return x + x; // NaN
      return xsb === 0 ? x : 0.0; // exp(+-inf) = {inf, 0}
    }
    if (x > o_threshold) return huge * huge; // overflow
    if (x < u_threshold) return twom1000 * twom1000; // underflow
  }

  if (hx > 0x3fd62e42) {
    if (hx < 0x3ff0a2b2) {
      // V8 returns the correctly rounded e for exp(1).
      if (x === 1.0) return E;
      hi = x - ln2HI[xsb];
      lo = ln2LO[xsb];
      k = 1 - xsb - xsb;
    } else {
      k = (invln2 * x + halF[xsb]) | 0;
      const t = k;
      hi = x - t * ln2HI[0];
      lo = t * ln2LO[0];
    }
    x = hi - lo;
  } else if (hx < 0x3e300000) {
    if (huge + x > 1.0) return 1.0 + x;
  } else {
    k = 0;
  }

  const t = x * x;
  const twopk =
    k >= -1021
      ? fromWords((0x3ff00000 + (k << 20)) | 0, 0)
      : fromWords((0x3ff00000 + ((k + 1000) << 20)) | 0, 0);
  const c = x - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
  if (k === 0) return 1.0 - ((x * c) / (c - 2.0) - x);
  const y = 1.0 - (lo - (x * c) / (2.0 - c) - hi);
  if (k >= -1021) {
    if (k === 1024) return y * 2.0 * two1023;
    return y * twopk;
  }
  return y * twopk * twom1000;
}

// ── log (msun e_log.c, as in V8 ieee754::log) ────────────────────────────────

const ln2_hi = 6.9314718036912381649e-1;
const ln2_lo = 1.90821492927058770002e-10;
const two54 = 1.8014398509481984e16;
const Lg1 = 6.66666666666673513e-1;
const Lg2 = 3.999999999940941908e-1;
const Lg3 = 2.857142874366239149e-1;
const Lg4 = 2.222219843214978396e-1;
const Lg5 = 1.818357216161805012e-1;
const Lg6 = 1.531383769920937332e-1;
const Lg7 = 1.479819860511658591e-1;

function log(x) {
  let hx = highWord(x);
  const lx = lowWord(x);
  let k = 0;
  if (hx < 0x00100000) {
    if (((hx & 0x7fffffff) | lx) === 0) return -two54 / 0.0; // log(+-0) = -inf
    if (hx < 0) return (x - x) / 0.0; // log(-#) = NaN
    k -= 54;
    x *= two54; // subnormal: scale up
    hx = highWord(x);
  }
  if (hx >= 0x7ff00000) return x + x;
  if (hx === 0x3ff00000 && lx === 0) return 0.0; // log(1) = +0
  k += (hx >> 20) - 1023;
  hx &= 0x000fffff;
  let i = (hx + 0x95f64) & 0x100000;
  x = withHighWord(x, hx | (i ^ 0x3ff00000)); // normalize x or x/2
  k += i >> 20;
  const f = x - 1.0;
  if ((0x000fffff & (2 + hx)) < 3) {
    // -2**-20 <= f < 2**-20
    if (f === 0.0) {
      if (k === 0) return 0.0;
      const dk = k;
      return dk * ln2_hi + dk * ln2_lo;
    }
    // fdlibm writes 0.33333333333333333; 0.3333333333333333 is the same double.
    const R = f * f * (0.5 - 0.3333333333333333 * f);
    if (k === 0) return f - R;
    const dk = k;
    return dk * ln2_hi - (R - dk * ln2_lo - f);
  }
  const s = f / (2.0 + f);
  const dk = k;
  const z = s * s;
  i = hx - 0x6147a;
  const w = z * z;
  const j = 0x6b851 - hx;
  const t1 = w * (Lg2 + w * (Lg4 + w * Lg6));
  const t2 = z * (Lg1 + w * (Lg3 + w * (Lg5 + w * Lg7)));
  i |= j;
  const R = t2 + t1;
  if (i > 0) {
    const hfsq = 0.5 * f * f;
    if (k === 0) return f - (hfsq - s * (hfsq + R));
    return dk * ln2_hi - (hfsq - (s * (hfsq + R) + dk * ln2_lo) - f);
  }
  if (k === 0) return f - s * (f - R);
  return dk * ln2_hi - (s * (f - R) - dk * ln2_lo - f);
}

// ── log1p (msun s_log1p.c, as in V8 ieee754::log1p) ──────────────────────────

const Lp1 = 6.66666666666673513e-1;
const Lp2 = 3.999999999940941908e-1;
const Lp3 = 2.857142874366239149e-1;
const Lp4 = 2.222219843214978396e-1;
const Lp5 = 1.818357216161805012e-1;
const Lp6 = 1.531383769920937332e-1;
const Lp7 = 1.479819860511658591e-1;

function log1p(x) {
  let f = 0;
  let c = 0;
  let hu = 0;
  const hx = highWord(x);
  const ax = hx & 0x7fffffff;

  let k = 1;
  if (hx < 0x3fda827a) {
    // 1+x < sqrt(2)+
    if (ax >= 0x3ff00000) {
      // x <= -1.0
      if (x === -1.0) return -two54 / 0.0; // log1p(-1) = -inf
      return (x - x) / (x - x); // log1p(x < -1) = NaN
    }
    if (ax < 0x3e200000) {
      // |x| < 2**-29
      if (two54 + x > 0.0 && ax < 0x3c900000) return x; // |x| < 2**-54
      return x - x * x * 0.5;
    }
    if (hx > 0 || hx <= (0xbfd2bec4 | 0)) {
      // sqrt(2)/2- <= 1+x < sqrt(2)+
      k = 0;
      f = x;
      hu = 1;
    }
  }
  if (hx >= 0x7ff00000) return x + x;
  if (k !== 0) {
    let u;
    if (hx < 0x43400000) {
      u = 1.0 + x;
      hu = highWord(u);
      k = (hu >> 20) - 1023;
      c = k > 0 ? 1.0 - (u - x) : x - (u - 1.0); // correction term
      c /= u;
    } else {
      u = x;
      hu = highWord(u);
      k = (hu >> 20) - 1023;
      c = 0;
    }
    hu &= 0x000fffff;
    if (hu < 0x6a09e) {
      // u ~< sqrt(2)
      u = withHighWord(u, hu | 0x3ff00000); // normalize u
    } else {
      k += 1;
      u = withHighWord(u, hu | 0x3fe00000); // normalize u/2
      hu = (0x00100000 - hu) >> 2;
    }
    f = u - 1.0;
  }
  const hfsq = 0.5 * f * f;
  if (hu === 0) {
    // |f| < 2**-20
    if (f === 0.0) {
      if (k === 0) return 0.0;
      c += k * ln2_lo;
      return k * ln2_hi + c;
    }
    // fdlibm writes 0.66666666666666666; 0.6666666666666666 is the same double.
    const R = hfsq * (1.0 - 0.6666666666666666 * f);
    if (k === 0) return f - R;
    return k * ln2_hi - (R - (k * ln2_lo + c) - f);
  }
  const s = f / (2.0 + f);
  const z = s * s;
  const R = z * (Lp1 + z * (Lp2 + z * (Lp3 + z * (Lp4 + z * (Lp5 + z * (Lp6 + z * Lp7))))));
  if (k === 0) return f - (hfsq - s * (hfsq + R));
  return k * ln2_hi - (hfsq - (s * (hfsq + R) + (k * ln2_lo + c)) - f);
}

export const __archbotMath = { exp, log, log1p };

// ── collation ────────────────────────────────────────────────────────────────

// ICU root collation (the production service's: Node, no LANG) of every string
// the core compares, lowest first. Strings in one group compare equal.
// Generated and checked by tests/archbot-determinism.test.ts.
const ROOT_ORDER = [
  ["-"],
  ["?"],
  ["/"],
  ["+"],
  ["+/-"],
  ["÷"],
  ["×"],
  ["="],
  ["0"],
  ["1"],
  ["10"],
  ["11"],
  ["12"],
  ["13"],
  ["14"],
  ["15"],
  ["16"],
  ["17"],
  ["18"],
  ["19"],
  ["2"],
  ["20"],
  ["3"],
  ["4"],
  ["5"],
  ["6"],
  ["7"],
  ["8"],
  ["9"],
  ["x"],
  ["x//"],
];

const rank = new Map();
ROOT_ORDER.forEach((group, index) => {
  for (const value of group) rank.set(value, index);
});

const HEX = /^[0-9a-f]+$/;
// For the diagnostic strings only (rejection codes and reasons, which never reach
// a decision): root collation, named explicitly instead of the user's locale.
const diagnosticCollator = new Intl.Collator("en-US");

/**
 * `a.localeCompare(b)` as the production runtime computes it, whatever the
 * player's locale:
 *
 *   tile kinds and faces    the fixed root-collation table above
 *   move and exchange ids   fixed-length lowercase hex, where root collation is
 *                           code-point order
 *   anything else           diagnostic text only; an explicit root-equivalent
 *                           collator
 */
export function __archbotCompare(a, b) {
  const ra = rank.get(a);
  const rb = rank.get(b);
  if (ra !== undefined && rb !== undefined) return ra - rb;
  if (a.length === b.length && HEX.test(a) && HEX.test(b)) return a < b ? -1 : a > b ? 1 : 0;
  return diagnosticCollator.compare(a, b);
}
