/**
 * Pure LaTeX transforms for function aliases. No Desmos dependencies.
 *
 * The graph stores vanilla-compatible identifiers such as `C_{ov2}` or
 * `a_{rea}`. The editor displays them as `C` or `\operatorname{area}`.
 */

export interface FnAlias {
  /** `C`, `f_{a}`, or a multi-character name like `area` (no backslash) */
  display: string;
  arity: number;
  /** Vanilla identifier as written in latex, e.g. `C_{ov2}` or `a_{rea}` */
  stored: string;
}

export class Registry {
  readonly displayByStored = new Map<string, string>();
  readonly storedByDisplayArity = new Map<string, string>();
  readonly multiCharNames = new Set<string>();

  constructor(readonly aliases: readonly FnAlias[]) {
    for (const a of aliases) {
      this.displayByStored.set(a.stored, a.display);
      this.storedByDisplayArity.set(key(a.display, a.arity), a.stored);
      if (isMultiChar(a.display)) this.multiCharNames.add(a.display);
    }
  }

  isEmpty() {
    return this.aliases.length === 0;
  }

  lookupStored(display: string, arity: number) {
    return this.storedByDisplayArity.get(key(display, arity));
  }
}

function key(display: string, arity: number) {
  return `${display}/${arity}`;
}

export function isMultiChar(display: string) {
  return /^[a-zA-Z]{2,}$/.test(display);
}

export function displayToLatex(display: string) {
  return isMultiChar(display) ? `\\operatorname{${display}}` : display;
}

interface Token {
  kind: "ident" | "opname" | "other";
  start: number;
  end: number;
  /** For ident: the identifier latex. For opname: the bare name. */
  name: string;
}

const IDENT_RE = /^[a-zA-Z](?:_\{[a-zA-Z0-9]+\}|_[a-zA-Z0-9])?/;
const OPNAME_RE = /^\\operatorname\{([a-zA-Z]+)\}/;
const COMMAND_RE = /^\\(?:[a-zA-Z]+|.)/;
const LETTER_RUN_BEFORE_PAREN_RE = /^[a-zA-Z]{2,}(?=\\left\()/;

/**
 * Tokenize just enough latex to find identifiers and operatornames.
 * `bareRunNames` are multi-character names that should also be recognized
 * when typed as plain letters (`area` rather than `\operatorname{area}`)
 * directly before a `\left(`.
 */
function tokenize(latex: string, bareRunNames?: Set<string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < latex.length) {
    const rest = latex.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = OPNAME_RE.exec(rest))) {
      tokens.push(token("opname", i, m[0].length, m[1]));
    } else if (rest.startsWith("\\")) {
      m = COMMAND_RE.exec(rest)!;
      tokens.push(token("other", i, m[0].length, m[0]));
    } else if (
      bareRunNames &&
      (m = LETTER_RUN_BEFORE_PAREN_RE.exec(rest)) &&
      bareRunNames.has(m[0])
    ) {
      tokens.push(token("opname", i, m[0].length, m[0]));
    } else if ((m = IDENT_RE.exec(rest))) {
      tokens.push(token("ident", i, m[0].length, m[0]));
    } else {
      tokens.push(token("other", i, 1, rest[0]));
    }
    i = tokens[tokens.length - 1].end;
  }
  return tokens;
}

function token(kind: Token["kind"], start: number, len: number, name: string) {
  return { kind, start, end: start + len, name };
}

/** Skip a `\left` or `\right` delimiter starting at `i`, returning the index after it. */
function skipDelimiter(latex: string, i: number) {
  if (latex[i] === "\\") return i + COMMAND_RE.exec(latex.slice(i))![0].length;
  return i + 1;
}

export interface ArgList {
  args: string[];
  /** Index just after the closing `\right)` */
  end: number;
}

/**
 * Parse an argument list starting at `pos`, which should point at `\left(`.
 * Returns the top-level comma-separated arguments.
 */
export function parseArgs(latex: string, pos: number): ArgList | undefined {
  if (!latex.startsWith("\\left(", pos)) return undefined;
  const args: string[] = [];
  let depth = 0;
  let i = pos + "\\left(".length;
  let argStart = i;
  while (i < latex.length) {
    if (latex.startsWith("\\left", i)) {
      depth++;
      i = skipDelimiter(latex, i + "\\left".length);
    } else if (latex.startsWith("\\right", i)) {
      if (depth === 0) {
        const last = latex.slice(argStart, i);
        if (args.length > 0 || last.trim() !== "") args.push(last);
        return { args, end: skipDelimiter(latex, i + "\\right".length) };
      }
      depth--;
      i = skipDelimiter(latex, i + "\\right".length);
    } else if (latex[i] === "\\") {
      i += COMMAND_RE.exec(latex.slice(i))![0].length;
    } else {
      const c = latex[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === "," && depth === 0) {
        args.push(latex.slice(argStart, i));
        argStart = i + 1;
      }
      i++;
    }
  }
  return undefined;
}

export interface DefinitionLHS {
  display: string;
  arity: number;
}

const PARAM_RE =
  /^\s*(?:[a-zA-Z](?:_\{[a-zA-Z0-9]+\}|_[a-zA-Z0-9])?|\\[a-zA-Z]+)\s*$/;

/**
 * Recognize `name\left(p_1,...,p_n\right)=` at the start of `latex`, where
 * `name` is an identifier, `\operatorname{word}`, or a bare run of 2+ letters.
 */
export function parseDefinitionLHS(latex: string): DefinitionLHS | undefined {
  const s = latex.trimStart();
  const opname = OPNAME_RE.exec(s);
  const m = opname ?? LETTER_RUN_BEFORE_PAREN_RE.exec(s) ?? IDENT_RE.exec(s);
  if (!m) return undefined;
  const display = opname ? opname[1] : m[0];
  const argList = parseArgs(s, m[0].length);
  if (!argList || argList.args.length === 0) return undefined;
  if (!argList.args.every((a) => PARAM_RE.test(a))) return undefined;
  if (!/^\s*=/.test(s.slice(argList.end))) return undefined;
  return { display, arity: argList.args.length };
}

/** Rewrite displayed names into stored identifiers, based on call arity. */
export function toStored(latex: string, registry: Registry) {
  if (registry.isEmpty()) return latex;
  const tokens = tokenize(latex, registry.multiCharNames);
  let out = "";
  let last = 0;
  for (const t of tokens) {
    if (t.kind === "other") continue;
    const argList = parseArgs(latex, t.end);
    if (!argList) continue;
    const stored = registry.lookupStored(t.name, argList.args.length);
    if (stored === undefined) continue;
    out += latex.slice(last, t.start) + stored;
    last = t.end;
  }
  return out + latex.slice(last);
}

/** Rewrite stored identifiers into their displayed names. */
export function toDisplay(latex: string, registry: Registry) {
  if (registry.isEmpty()) return latex;
  const tokens = tokenize(latex);
  let out = "";
  let last = 0;
  for (const t of tokens) {
    if (t.kind !== "ident") continue;
    const display = registry.displayByStored.get(t.name);
    if (display === undefined) continue;
    out += latex.slice(last, t.start) + displayToLatex(display);
    last = t.end;
  }
  return out + latex.slice(last);
}

/** All identifiers (in latex form) appearing in `latex`. */
export function identifiersIn(latex: string): string[] {
  return tokenize(latex)
    .filter((t) => t.kind === "ident")
    .map((t) => t.name);
}

/**
 * Pick a vanilla identifier for an alias.
 *   area → a_{rea}, or a_{reaov2} if overloaded
 *   C → C_{ov2};  f_{a} → f_{aov2}
 * Appends a digit if the name is already taken.
 */
export function makeStoredName(
  display: string,
  arity: number,
  overloaded: boolean,
  taken: Set<string>
) {
  let letter: string;
  let sub: string;
  if (isMultiChar(display)) {
    letter = display.charAt(0);
    sub = display.slice(1) + (overloaded ? `ov${arity}` : "");
  } else {
    const m = /^([a-zA-Z])(?:_\{([a-zA-Z0-9]+)\}|_([a-zA-Z0-9]))?$/.exec(
      display
    );
    if (!m) throw new Error(`Invalid function name: ${display}`);
    const [, l, braced, bare] = m;
    letter = l;
    sub = (braced ?? bare ?? "") + `ov${arity}`;
  }
  let candidate = `${letter}_{${sub}}`;
  for (let n = 1; taken.has(candidate); n++) {
    candidate = `${letter}_{${sub}${n}}`;
  }
  return candidate;
}
