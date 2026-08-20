/**
 * Small, deliberately boring arithmetic language for trusted chart/sensor
 * formulas. It never evaluates JavaScript and rejects unknown identifiers,
 * malformed syntax, and division by zero.
 */

export type ExpressionValues = Record<string, unknown>;

export function resolveSafeExpression(formula: string, values: ExpressionValues): number | null {
  if (formula.length === 0 || formula.length > 512) return null;
  let missingValue = false;
  const expression = formula.replace(/\[([^\]]+)\]/g, (_match, rawPath: string) => {
    const value = resolveSafeNumberPath(values, rawPath.trim());
    if (value == null) {
      missingValue = true;
      return '0';
    }
    return String(value);
  });
  if (missingValue) return null;
  const parsed = parseSafeMathExpression(expression);
  return parsed != null && Number.isFinite(parsed) ? parsed : null;
}

export function resolveSafeNumberPath(values: ExpressionValues, path: string): number | null {
  if (!path) return null;
  const value = path.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[part];
  }, values);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function parseSafeMathExpression(expression: string): number | null {
  if (expression.length === 0 || expression.length > 512) return null;
  let index = 0;

  function skipSpace() {
    while (/\s/.test(expression[index] ?? '')) index += 1;
  }

  function parseNumber() {
    skipSpace();
    const match = expression.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if (!match) return null;
    index += match[0].length;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : null;
  }

  function parseFactor(): number | null {
    skipSpace();
    const char = expression[index];
    if (char === '+' || char === '-') {
      index += 1;
      const value = parseFactor();
      return value == null ? null : char === '-' ? -value : value;
    }
    if (char === '(') {
      index += 1;
      const value = parseExpression();
      skipSpace();
      if (expression[index] !== ')') return null;
      index += 1;
      return value;
    }
    return parseNumber();
  }

  function parseTerm(): number | null {
    let value = parseFactor();
    if (value == null) return null;
    while (true) {
      skipSpace();
      const op = expression[index];
      if (op !== '*' && op !== '/') return value;
      index += 1;
      const right = parseFactor();
      if (right == null || (op === '/' && right === 0)) return null;
      value = op === '*' ? value * right : value / right;
    }
  }

  function parseExpression(): number | null {
    let value = parseTerm();
    if (value == null) return null;
    while (true) {
      skipSpace();
      const op = expression[index];
      if (op !== '+' && op !== '-') return value;
      index += 1;
      const right = parseTerm();
      if (right == null) return null;
      value = op === '+' ? value + right : value - right;
    }
  }

  const result = parseExpression();
  skipSpace();
  return index === expression.length && result != null && Number.isFinite(result) ? result : null;
}
