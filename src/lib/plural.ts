/** Форма слова после числа: «1 ключ», «3 ключа», «5 ключей». */
export function plural(count: number, [one, few, many]: [string, string, string]): string {
  const tens = Math.abs(count) % 100, units = Math.abs(count) % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}
