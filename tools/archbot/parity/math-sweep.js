// A deterministic sweep of inputs for exp / log / log1p: edge cases, the ranges
// the Stage 5B core actually uses, and arbitrary bit patterns. Shared by the
// golden generator (run on the production runtime) and the determinism test.

const SPECIALS = [
  0,
  -0,
  1,
  -1,
  2,
  0.5,
  Infinity,
  -Infinity,
  NaN,
  1e-300,
  5e-324,
  2.2250738585072014e-308,
  709.78,
  709.782712893384,
  709.79,
  -745.13,
  -745.1332191019411,
  -745.14,
  1e-10,
  1e-20,
  1e-30,
  0.34657359027997264,
  1.0397207708399179,
  -0.9999999999,
  -0.99,
  0.41421356,
  -0.29289321,
  1024,
  1e308,
  Number.MAX_VALUE,
  Number.MIN_VALUE,
];

export function mathSweep(fn, count = 400_000) {
  let seed = 20260929;
  const random = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296;
  const bits = new Float64Array(1);
  const words = new Uint32Array(bits.buffer);
  const arbitrary = () => {
    words[0] = (random() * 4294967296) >>> 0;
    words[1] = (random() * 4294967296) >>> 0;
    return bits[0];
  };
  const inputs = new Float64Array(SPECIALS.length * 2 + count);
  let index = 0;
  for (const value of SPECIALS) {
    inputs[index++] = value;
    inputs[index++] = -value;
  }
  for (let i = 0; i < count; i += 1) {
    const r = random();
    let x;
    if (i % 5 === 0) x = arbitrary();
    else if (fn === "exp") x = (r - 0.5) * (i % 2 ? 60 : 1500);
    else if (fn === "log")
      x = i % 2 ? r * 10 : r * r * r * r * r * r * r * r; // not **: pow is platform-dependent
    else x = i % 2 ? r * 100 - 1 : (r - 0.5) * 1e-6;
    inputs[index++] = x;
  }
  return inputs;
}

/**
 * Outputs of `f` over the sweep, as bytes to hash. Every NaN is written as one
 * canonical NaN: JavaScript cannot observe a NaN's bits, and processors disagree
 * on them (x86 sets the sign bit of an invalid operation's NaN, arm64 does not).
 */
export function sweepBytes(fn, f, count) {
  const inputs = mathSweep(fn, count);
  const outputs = new Float64Array(inputs.length);
  for (let i = 0; i < inputs.length; i += 1) {
    const value = f(inputs[i]);
    outputs[i] = Number.isNaN(value) ? Number.NaN : value;
  }
  return new Uint8Array(outputs.buffer);
}
