import { GAME_RULES, type SkillType } from "./rules";

export type ScriptActionName = "forward" | "turnleft" | "turnright" | "dash" | "skill";
export interface ScriptAction { name: ScriptActionName; duration?: number }
export const SCRIPT_EXECUTION_LIMIT = 220;
export const SCRIPT_CALL_DEPTH_LIMIT = 12;

export interface ScriptGameState {
  game: {
    elapsed: number;
    arena: { radius: number };
    self: { distanceFromCenter: number; angleToCenter: number; dashReady: boolean; skillReady: boolean; skill: SkillType };
    enemy: { distance: number; angle: number; stunned: boolean; stone: boolean };
  };
}

type TokenKind = "number" | "string" | "identifier" | "keyword" | "operator" | "punctuation" | "eof";
interface Token { kind: TokenKind; value: string; position: number }

type Expression =
  | { type: "literal"; value: number | string | boolean | null }
  | { type: "variable"; name: string }
  | { type: "member"; object: Expression; property: string }
  | { type: "call"; callee: Expression; args: Expression[] }
  | { type: "unary"; operator: string; value: Expression }
  | { type: "binary"; operator: string; left: Expression; right: Expression };

type Statement =
  | { type: "block"; body: Statement[] }
  | { type: "variable"; name: string; value: Expression; constant: boolean }
  | { type: "assignment"; name: string; value: Expression }
  | { type: "if"; condition: Expression; then: Statement; otherwise?: Statement }
  | { type: "return"; value?: Expression }
  | { type: "expression"; value: Expression };

interface FunctionDeclaration { name: string; params: string[]; body: Statement }
export interface BotScriptProgram { globals: Array<Extract<Statement, { type: "variable" }>>; functions: Map<string, FunctionDeclaration> }

const KEYWORDS = new Set(["function", "let", "const", "if", "else", "return", "true", "false", "null"]);

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const push = (kind: TokenKind, value: string, position = index) => tokens.push({ kind, value, position });
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if (source.startsWith("//", index)) {
      index = source.indexOf("\n", index);
      if (index < 0) index = source.length;
      continue;
    }
    if (source.startsWith("/*", index)) {
      const end = source.indexOf("*/", index + 2);
      if (end < 0) throw new Error("Unclosed block comment.");
      index = end + 2;
      continue;
    }
    const number = source.slice(index).match(/^\d+(?:\.\d+)?/);
    if (number) { push("number", number[0]); index += number[0].length; continue; }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = "";
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\") {
          index += 1;
          const escaped = source[index];
          value += escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped;
        } else value += source[index];
        index += 1;
      }
      if (source[index] !== quote) throw new Error(`Unclosed string at character ${start + 1}.`);
      index += 1;
      push("string", value, start);
      continue;
    }
    const identifier = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (identifier) {
      push(KEYWORDS.has(identifier[0]) ? "keyword" : "identifier", identifier[0]);
      index += identifier[0].length;
      continue;
    }
    const operator = ["===", "!==", "==", "!=", "<=", ">=", "&&", "||", "+", "-", "*", "/", "!", "=", "<", ">"].find((item) => source.startsWith(item, index));
    if (operator) { push("operator", operator); index += operator.length; continue; }
    if ("(){};, .".includes(char) && char !== " ") { push("punctuation", char); index += 1; continue; }
    throw new Error(`Unsupported character "${char}" at character ${index + 1}.`);
  }
  push("eof", "", index);
  return tokens;
}

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[]) {}
  private current() { return this.tokens[this.index]; }
  private match(value: string) { if (this.current().value !== value) return false; this.index += 1; return true; }
  private expect(value: string) {
    if (!this.match(value)) throw new Error(`Expected "${value}" near character ${this.current().position + 1}.`);
  }
  private identifier() {
    const token = this.current();
    if (token.kind !== "identifier") throw new Error(`Expected a name near character ${token.position + 1}.`);
    this.index += 1;
    return token.value;
  }
  parse(): BotScriptProgram {
    const globals: BotScriptProgram["globals"] = [];
    const functions = new Map<string, FunctionDeclaration>();
    while (this.current().kind !== "eof") {
      if (this.current().value === "let" || this.current().value === "const") globals.push(this.variableDeclaration());
      else if (this.match("function")) {
        const declaration = this.functionDeclaration();
        if (functions.has(declaration.name)) throw new Error(`Function "${declaration.name}" is defined more than once.`);
        functions.set(declaration.name, declaration);
      } else throw new Error(`Only variables and functions are allowed at the script's top level (character ${this.current().position + 1}).`);
    }
    if (!functions.has("decide")) throw new Error("Script must define function decide(game).");
    return { globals, functions };
  }
  private functionDeclaration(): FunctionDeclaration {
    const name = this.identifier();
    this.expect("(");
    const params: string[] = [];
    if (!this.match(")")) {
      do { params.push(this.identifier()); } while (this.match(","));
      this.expect(")");
    }
    return { name, params, body: this.block() };
  }
  private block(): Statement {
    this.expect("{");
    const body: Statement[] = [];
    while (!this.match("}")) {
      if (this.current().kind === "eof") throw new Error("Unclosed code block.");
      body.push(this.statement());
    }
    return { type: "block", body };
  }
  private variableDeclaration(): Extract<Statement, { type: "variable" }> {
    const constant = this.match("const");
    if (!constant) this.expect("let");
    const name = this.identifier();
    this.expect("=");
    const value = this.expression();
    this.expect(";");
    return { type: "variable", name, value, constant };
  }
  private statement(): Statement {
    if (this.current().value === "{") return this.block();
    if (this.current().value === "let" || this.current().value === "const") return this.variableDeclaration();
    if (this.match("if")) {
      this.expect("(");
      const condition = this.expression();
      this.expect(")");
      const then = this.statement();
      const otherwise = this.match("else") ? this.statement() : undefined;
      return { type: "if", condition, then, otherwise };
    }
    if (this.match("return")) {
      if (this.match(";")) return { type: "return" };
      const value = this.expression();
      this.expect(";");
      return { type: "return", value };
    }
    const value = this.expression();
    if (this.match("=")) {
      if (value.type !== "variable") throw new Error("Only named script variables can be assigned.");
      const assigned = this.expression();
      this.expect(";");
      return { type: "assignment", name: value.name, value: assigned };
    }
    this.expect(";");
    return { type: "expression", value };
  }
  private expression(minimum = 0): Expression {
    let left = this.unary();
    const precedence: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "===": 3, "!=": 3, "!==": 3, "<": 4, "<=": 4, ">": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6 };
    while ((precedence[this.current().value] ?? 0) > minimum) {
      const operator = this.current().value;
      const level = precedence[operator];
      this.index += 1;
      left = { type: "binary", operator, left, right: this.expression(level) };
    }
    return left;
  }
  private unary(): Expression {
    if (this.current().value === "!" || this.current().value === "-") {
      const operator = this.current().value;
      this.index += 1;
      return { type: "unary", operator, value: this.unary() };
    }
    return this.postfix();
  }
  private postfix(): Expression {
    let value = this.primary();
    while (true) {
      if (this.match(".")) value = { type: "member", object: value, property: this.identifier() };
      else if (this.match("(")) {
        const args: Expression[] = [];
        if (!this.match(")")) {
          do { args.push(this.expression()); } while (this.match(","));
          this.expect(")");
        }
        value = { type: "call", callee: value, args };
      } else break;
    }
    return value;
  }
  private primary(): Expression {
    const token = this.current();
    if (token.kind === "number") { this.index += 1; return { type: "literal", value: Number(token.value) }; }
    if (token.kind === "string") { this.index += 1; return { type: "literal", value: token.value }; }
    if (token.value === "true" || token.value === "false" || token.value === "null") {
      this.index += 1;
      return { type: "literal", value: token.value === "null" ? null : token.value === "true" };
    }
    if (token.kind === "identifier") { this.index += 1; return { type: "variable", name: token.value }; }
    if (this.match("(")) { const value = this.expression(); this.expect(")"); return value; }
    throw new Error(`Expected a value near character ${token.position + 1}.`);
  }
}

type RuntimeValue = number | string | boolean | null | ScriptAction | Record<string, unknown>;
export type ScriptRuntimeSnapshot = Record<string, number | string | boolean | null>;
interface Scope { values: Map<string, RuntimeValue>; constants: Set<string> }
interface Execution { returned: boolean; value?: RuntimeValue }

export function parseBotScript(source: string): BotScriptProgram {
  return new Parser(tokenize(source)).parse();
}

export function migrateLegacyJsonScript(source: string) {
  if (!source.trim().startsWith("{")) return source;
  let legacy: { initialState?: string; functions?: Record<string, Array<{ when?: string; do?: string }>>; states?: Record<string, Array<{ when?: string; do?: string }>> };
  try { legacy = JSON.parse(source) as typeof legacy; }
  catch { return PRIMITIVE_FALLBACK; }
  if (!legacy.initialState || !legacy.states?.[legacy.initialState]) return PRIMITIVE_FALLBACK;
  const safeName = (value: string) => value.replace(/[^A-Za-z0-9_]/g, "_");
  const condition = (value: string) => value.replaceAll("state.elapsed", "(game.elapsed - stateChangedAt)").replaceAll("state.name", "state");
  const command = (value: string) => {
    const call = value.match(/^call\(([A-Za-z_][A-Za-z0-9_-]*)\)$/);
    if (call) return `return ${safeName(call[1])}(game);`;
    const go = value.match(/^goto\(([A-Za-z_][A-Za-z0-9_-]*)\)$/);
    if (go) return `state = "${go[1]}"; stateChangedAt = game.elapsed; return state_${safeName(go[1])}(game);`;
    return `return ${value};`;
  };
  const rules = (items: Array<{ when?: string; do?: string }>) => items.map((rule) => {
    if (!rule.do) return "  // Skipped an invalid legacy rule.";
    return rule.when ? `  if (${condition(rule.when)}) { ${command(rule.do)} }` : `  ${command(rule.do)}`;
  }).join("\n");
  const helpers = Object.entries(legacy.functions ?? {}).map(([name, items]) => `function ${safeName(name)}(game) {\n${rules(items)}\n}`).join("\n\n");
  const states = Object.entries(legacy.states).map(([name, items]) => `function state_${safeName(name)}(game) {\n${rules(items)}\n}`).join("\n\n");
  const dispatch = Object.keys(legacy.states).map((name) => `  if (state == "${name}") return state_${safeName(name)}(game);`).join("\n");
  return `// Automatically migrated from the earlier JSON strategy format.\nlet state = "${legacy.initialState}";\nlet stateChangedAt = 0;\n\n${helpers}${helpers ? "\n\n" : ""}${states}\n\nfunction decide(game) {\n${dispatch}\n  return state_${safeName(legacy.initialState)}(game);\n}`;
}

const PRIMITIVE_FALLBACK = `function decide(game) {\n  if (game.enemy.angle < -10) return turnleft(0.1);\n  if (game.enemy.angle > 10) return turnright(0.1);\n  return forward(0.2);\n}`;

export function createScriptRuntime(source: string) {
  const program = parseBotScript(source);
  let globals: Scope;
  let budget = 0;

  const readVariable = (name: string, local: Scope): RuntimeValue => {
    if (local.values.has(name)) return local.values.get(name)!;
    if (globals.values.has(name)) return globals.values.get(name)!;
    throw new Error(`Unknown variable "${name}".`);
  };
  const number = (value: RuntimeValue) => {
    if (typeof value !== "number") throw new Error("This operation requires numbers.");
    return value;
  };
  const evaluate = (expression: Expression, local: Scope, depth: number): RuntimeValue => {
    if (expression.type === "literal") return expression.value;
    if (expression.type === "variable") return readVariable(expression.name, local);
    if (expression.type === "member") {
      const object = evaluate(expression.object, local, depth);
      if (!object || typeof object !== "object" || !(expression.property in object)) throw new Error(`Unknown sensor property "${expression.property}".`);
      const value = (object as Record<string, unknown>)[expression.property];
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean" && value !== null && typeof value !== "object") throw new Error(`Property "${expression.property}" cannot be read.`);
      return value as RuntimeValue;
    }
    if (expression.type === "unary") {
      const value = evaluate(expression.value, local, depth);
      return expression.operator === "!" ? !Boolean(value) : -number(value);
    }
    if (expression.type === "binary") {
      const left = evaluate(expression.left, local, depth);
      if (expression.operator === "&&") return Boolean(left) && Boolean(evaluate(expression.right, local, depth));
      if (expression.operator === "||") return Boolean(left) || Boolean(evaluate(expression.right, local, depth));
      const right = evaluate(expression.right, local, depth);
      if (expression.operator === "+") return number(left) + number(right);
      if (expression.operator === "-") return number(left) - number(right);
      if (expression.operator === "*") return number(left) * number(right);
      if (expression.operator === "/") return number(left) / number(right);
      if (expression.operator === "<") return number(left) < number(right);
      if (expression.operator === "<=") return number(left) <= number(right);
      if (expression.operator === ">") return number(left) > number(right);
      if (expression.operator === ">=") return number(left) >= number(right);
      if (expression.operator === "==" || expression.operator === "===") return left === right;
      return left !== right;
    }
    if (expression.callee.type !== "variable") throw new Error("Only named functions can be called.");
    const name = expression.callee.name;
    const args = expression.args.map((item) => evaluate(item, local, depth));
    if (["forward", "turnleft", "turnright"].includes(name)) {
      const duration = number(args[0]);
      if (args.length !== 1 || duration < GAME_RULES.actionDuration.minimum || duration > GAME_RULES.actionDuration.maximum) throw new Error(`${name}(x) requires one duration from 0.1 to 3 seconds.`);
      return { name: name as ScriptActionName, duration };
    }
    if (name === "dash" || name === "skill") {
      if (args.length) throw new Error(`${name}() does not take arguments.`);
      return { name };
    }
    if (name === "abs") {
      if (args.length !== 1) throw new Error("abs(x) requires one number.");
      return Math.abs(number(args[0]));
    }
    if (name === "min" || name === "max") {
      if (args.length !== 2) throw new Error(`${name}(a, b) requires two numbers.`);
      return name === "min" ? Math.min(number(args[0]), number(args[1])) : Math.max(number(args[0]), number(args[1]));
    }
    if (name === "clamp") {
      if (args.length !== 3) throw new Error("clamp(value, low, high) requires three numbers.");
      const value = number(args[0]);
      const low = number(args[1]);
      const high = number(args[2]);
      if (low > high) throw new Error("clamp(value, low, high) requires low to be at most high.");
      return Math.min(high, Math.max(low, value));
    }
    return callFunction(name, args, depth + 1);
  };

  const run = (statement: Statement, local: Scope, depth: number): Execution => {
    budget += 1;
    if (budget > SCRIPT_EXECUTION_LIMIT) throw new Error("Script exceeded the per-tick execution limit.");
    if (statement.type === "block") {
      for (const child of statement.body) { const result = run(child, local, depth); if (result.returned) return result; }
      return { returned: false };
    }
    if (statement.type === "variable") {
      if (local.values.has(statement.name)) throw new Error(`Variable "${statement.name}" is already defined here.`);
      local.values.set(statement.name, evaluate(statement.value, local, depth));
      if (statement.constant) local.constants.add(statement.name);
      return { returned: false };
    }
    if (statement.type === "assignment") {
      const scope = local.values.has(statement.name) ? local : globals;
      if (!scope.values.has(statement.name)) throw new Error(`Cannot assign unknown variable "${statement.name}".`);
      if (scope.constants.has(statement.name)) throw new Error(`Cannot change constant "${statement.name}".`);
      scope.values.set(statement.name, evaluate(statement.value, local, depth));
      return { returned: false };
    }
    if (statement.type === "if") {
      if (Boolean(evaluate(statement.condition, local, depth))) return run(statement.then, local, depth);
      return statement.otherwise ? run(statement.otherwise, local, depth) : { returned: false };
    }
    if (statement.type === "return") return { returned: true, value: statement.value ? evaluate(statement.value, local, depth) : null };
    evaluate(statement.value, local, depth);
    return { returned: false };
  };

  const callFunction = (name: string, args: RuntimeValue[], depth: number): RuntimeValue => {
    if (depth > SCRIPT_CALL_DEPTH_LIMIT) throw new Error("Script function call limit exceeded.");
    const fn = program.functions.get(name);
    if (!fn) throw new Error(`Unknown function "${name}".`);
    if (args.length !== fn.params.length) throw new Error(`${name}() expects ${fn.params.length} argument${fn.params.length === 1 ? "" : "s"}.`);
    const local: Scope = { values: new Map(fn.params.map((param, index) => [param, args[index]])), constants: new Set(fn.params) };
    return run(fn.body, local, depth).value ?? null;
  };

  const initialize = () => {
    globals = { values: new Map(), constants: new Set() };
    const empty: Scope = { values: new Map(), constants: new Set() };
    program.globals.forEach((declaration) => {
      if (globals.values.has(declaration.name)) throw new Error(`Global variable "${declaration.name}" is defined more than once.`);
      globals.values.set(declaration.name, evaluate(declaration.value, empty, 0));
      if (declaration.constant) globals.constants.add(declaration.name);
    });
  };
  initialize();

  return {
    reset: initialize,
    snapshot(): ScriptRuntimeSnapshot {
      return Object.fromEntries(Array.from(globals.values.entries()).filter((entry): entry is [string, number | string | boolean | null] => {
        const value = entry[1];
        return value === null || typeof value === "number" || typeof value === "string" || typeof value === "boolean";
      }));
    },
    restore(snapshot: ScriptRuntimeSnapshot) {
      for (const [name, value] of Object.entries(snapshot)) {
        if (!globals.values.has(name)) throw new Error(`Cannot restore unknown global variable "${name}".`);
        globals.values.set(name, value);
      }
    },
    decide(input: ScriptGameState) {
      budget = 0;
      const result = callFunction("decide", [input.game], 0);
      if (result === null) return null;
      if (!result || typeof result !== "object" || !("name" in result)) throw new Error("decide(game) must return an action such as forward(0.2).");
      return result as ScriptAction;
    },
  };
}
