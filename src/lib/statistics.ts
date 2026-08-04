/**
 * Generates a normally distributed (Gaussian / Bell Curve) random number 
 * using the Box-Muller transform.
 * 
 * @param min The minimum boundary
 * @param max The maximum boundary
 * @param skew > 1 shifts the peak towards max, < 1 shifts peak towards min
 */
export function generateGaussian(min: number, max: number, skew: number = 1): number {
  // Iterative resampling (safe — never blows the call stack)
  let num = -1;
  while (num < 0 || num > 1) {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    num = num / 10.0 + 0.5;
  }

  num = Math.pow(num, skew); // Apply statistical skew
  num *= max - min; // Stretch to fill range
  num += min; // offset to min
  return num;
}

export function generateGaussianInt(min: number, max: number, skew: number = 1): number {
  return Math.round(generateGaussian(min, max, skew));
}

export function generateGaussianFloat(min: number, max: number, fractionDigits: number = 2, skew: number = 1): number {
  return Number(generateGaussian(min, max, skew).toFixed(fractionDigits));
}
