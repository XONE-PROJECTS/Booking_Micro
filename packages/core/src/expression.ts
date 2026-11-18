import Decimal from 'decimal.js';

/**
 * Safe arithmetic expression evaluator for admin-defined pricing formulas.
 * Supports numbers, whitelisted variables, + - * / %, comparisons, && || !, parentheses,
 * and the functions min, max, round, ceil, floor, abs and if(condition, then, else).
 * There is no property access, assignment, or call to anything outside this whitelist.
 */

type Token =
  | { t: 'num'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: string }
  | { t: '('; v: '(' }
  | { t: ')'; v: ')' }
  | { t: ','; v: ',' };

type Node =
  | { k: 'num'; v: Decimal }
  | { k: 'var'; name: string }
  | { k: 'unary'; op: '-' | '!'; arg: Node }
  | { k: 'bin'; op: string; left: Node; right: Node }
  | { k: 'call'; fn: string; args: Node[] };

const FUNCTIONS: Record<string, [number, number]> = {
  min: [1, 20],
  max: [1, 20],
  round: [1, 2],
  ceil: [1, 1],
  floor: [1, 1],
  abs: [1, 1],
  if: [3, 3],
};

const MAX_LENGTH = 500;
const MAX_DEPTH = 40;

export class ExpressionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpressionError';
  }
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j]!)) j++;
      const v = src.slice(i, j);
      if (!/^\d+(\.\d+)?$|^\.\d+$/.test(v)) throw new ExpressionError(`Invalid number "${v}"`);
      tokens.push({ t: 'num', v });
      i = j;
      continue;
    }
    if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j]!)) j++;
      tokens.push({ t: 'id', v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if ('+-*/%<>!'.includes(c)) {
      tokens.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(' || c === ')' || c === ',') {
      tokens.push({ t: c, v: c } as Token);
      i++;
      continue;
    }
    throw new ExpressionError(`Unexpected character "${c}"`);
  }
  return tokens;
}

class Parser {
  private pos = 0;
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly variables: ReadonlySet<string>,
  ) {}

  parse(): Node {
    const node = this.or();
    if (this.pos < this.tokens.length) throw new ExpressionError(`Unexpected token "${this.tokens[this.pos]!.v}"`);
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private isOp(...ops: string[]): string | null {
    const t = this.peek();
    return t && t.t === 'op' && ops.includes(t.v) ? t.v : null;
  }

  private enter() {
    if (++this.depth > MAX_DEPTH) throw new ExpressionError('Expression is nested too deeply');
  }

  private or(): Node {
    let left = this.and();
    while (this.isOp('||')) {
      this.pos++;
      left = { k: 'bin', op: '||', left, right: this.and() };
    }
    return left;
  }

  private and(): Node {
    let left = this.cmp();
    while (this.isOp('&&')) {
      this.pos++;
      left = { k: 'bin', op: '&&', left, right: this.cmp() };
    }
    return left;
  }

  private cmp(): Node {
    const left = this.add();
    const op = this.isOp('==', '!=', '<', '<=', '>', '>=');
    if (op) {
      this.pos++;
      return { k: 'bin', op, left, right: this.add() };
    }
    return left;
  }

  private add(): Node {
    let left = this.mul();
    let op: string | null;
    while ((op = this.isOp('+', '-'))) {
      this.pos++;
      left = { k: 'bin', op, left, right: this.mul() };
    }
    return left;
  }

  private mul(): Node {
    let left = this.unary();
    let op: string | null;
    while ((op = this.isOp('*', '/', '%'))) {
      this.pos++;
      left = { k: 'bin', op, left, right: this.unary() };
    }
    return left;
  }

  private unary(): Node {
    const op = this.isOp('-', '!');
    if (op) {
      this.pos++;
      this.enter();
      const arg = this.unary();
      this.depth--;
      return { k: 'unary', op: op as '-' | '!', arg };
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (!t) throw new ExpressionError('Unexpected end of expression');
    if (t.t === 'num') {
      this.pos++;
      return { k: 'num', v: new Decimal(t.v) };
    }
    if (t.t === '(') {
      this.pos++;
      this.enter();
      const node = this.or();
      this.depth--;
      if (this.peek()?.t !== ')') throw new ExpressionError('Missing ")"');
      this.pos++;
      return node;
    }
    if (t.t === 'id') {
      this.pos++;
      if (this.peek()?.t === '(') {
        const arity = FUNCTIONS[t.v];
        if (!arity) throw new ExpressionError(`Unknown function "${t.v}"`);
        this.pos++;
        this.enter();
        const args: Node[] = [];
        if (this.peek()?.t !== ')') {
          args.push(this.or());
          while (this.peek()?.t === ',') {
            this.pos++;
            args.push(this.or());
          }
        }
        this.depth--;
        if (this.peek()?.t !== ')') throw new ExpressionError(`Missing ")" after arguments of ${t.v}`);
        this.pos++;
        if (args.length < arity[0] || args.length > arity[1]) {
          throw new ExpressionError(`Function ${t.v} expects ${arity[0]}-${arity[1]} arguments`);
        }
        return { k: 'call', fn: t.v, args };
      }
      if (!this.variables.has(t.v)) throw new ExpressionError(`Unknown variable "${t.v}"`);
      return { k: 'var', name: t.v };
    }
    throw new ExpressionError(`Unexpected token "${t.v}"`);
  }
}

const ONE = new Decimal(1);
const ZERO = new Decimal(0);
const truthy = (d: Decimal) => !d.isZero();
const bool = (b: boolean) => (b ? ONE : ZERO);

function evaluate(node: Node, vars: Record<string, Decimal.Value>): Decimal {
  switch (node.k) {
    case 'num':
      return node.v;
    case 'var':
      return new Decimal(vars[node.name] ?? 0);
    case 'unary': {
      const v = evaluate(node.arg, vars);
      return node.op === '-' ? v.negated() : bool(!truthy(v));
    }
    case 'bin': {
      if (node.op === '&&') return bool(truthy(evaluate(node.left, vars)) && truthy(evaluate(node.right, vars)));
      if (node.op === '||') return bool(truthy(evaluate(node.left, vars)) || truthy(evaluate(node.right, vars)));
      const a = evaluate(node.left, vars);
      const b = evaluate(node.right, vars);
      switch (node.op) {
        case '+':
          return a.plus(b);
        case '-':
          return a.minus(b);
        case '*':
          return a.times(b);
        case '/':
          if (b.isZero()) throw new ExpressionError('Division by zero');
          return a.dividedBy(b);
        case '%':
          if (b.isZero()) throw new ExpressionError('Division by zero');
          return a.mod(b);
        case '==':
          return bool(a.equals(b));
        case '!=':
          return bool(!a.equals(b));
        case '<':
          return bool(a.lessThan(b));
        case '<=':
          return bool(a.lessThanOrEqualTo(b));
        case '>':
          return bool(a.greaterThan(b));
        case '>=':
          return bool(a.greaterThanOrEqualTo(b));
      }
      throw new ExpressionError(`Unknown operator ${node.op}`);
    }
    case 'call': {
      if (node.fn === 'if') return truthy(evaluate(node.args[0]!, vars)) ? evaluate(node.args[1]!, vars) : evaluate(node.args[2]!, vars);
      const args = node.args.map((a) => evaluate(a, vars));
      switch (node.fn) {
        case 'min':
          return Decimal.min(...args);
        case 'max':
          return Decimal.max(...args);
        case 'round':
          return args[0]!.toDecimalPlaces(args[1] ? args[1].toNumber() : 0, Decimal.ROUND_HALF_UP);
        case 'ceil':
          return args[0]!.ceil();
        case 'floor':
          return args[0]!.floor();
        case 'abs':
          return args[0]!.abs();
      }
      throw new ExpressionError(`Unknown function ${node.fn}`);
    }
  }
}

export interface CompiledExpression {
  source: string;
  variables: string[];
  evaluate(vars: Record<string, Decimal.Value>): Decimal;
}

export function compileExpression(source: string, allowedVariables: readonly string[]): CompiledExpression {
  if (source.length > MAX_LENGTH) throw new ExpressionError(`Expression exceeds ${MAX_LENGTH} characters`);
  const allowed = new Set(allowedVariables);
  const ast = new Parser(tokenize(source), allowed).parse();
  const used = new Set<string>();
  const walk = (n: Node) => {
    if (n.k === 'var') used.add(n.name);
    if (n.k === 'unary') walk(n.arg);
    if (n.k === 'bin') {
      walk(n.left);
      walk(n.right);
    }
    if (n.k === 'call') n.args.forEach(walk);
  };
  walk(ast);
  return { source, variables: [...used], evaluate: (vars) => evaluate(ast, vars) };
}
