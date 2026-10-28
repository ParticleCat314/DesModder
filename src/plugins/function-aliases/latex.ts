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
/**
 * A name typed before `\left(`, possibly split into upright and plain parts.
 * Mathquill writes `\operatorname{sdf}Line` when letters are typed after a
 * name it already knows, so that's read as `sdfLine`.
 */
const WORD_BEFORE_PAREN_RE =
  /^(?:\\operatorname\{[a-zA-Z]+\}|[a-zA-Z])+(?=\\left\()/;

function wordName(word: string) {
  return word.replace(/\\operatorname\{([a-zA-Z]+)\}/g, "$1");
}

/**
 * Tokenize just enough latex to find identifiers and operatornames.
 * `wordNames` are multi-character names that should also be recognized
 * when typed as plain or partly plain letters (`area`, `\operatorname{ar}ea`)
 * directly before a `\left(`.
 */
function tokenize(latex: string, wordNames?: Set<string>): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < latex.length) {
    const rest = latex.slice(i);
    let m: RegExpMatchArray | null;
    if (
      wordNames &&
      (m = WORD_BEFORE_PAREN_RE.exec(rest)) &&
      wordNames.has(wordName(m[0]))
    ) {
      tokens.push(token("opname", i, m[0].length, wordName(m[0])));
    } else if ((m = OPNAME_RE.exec(rest))) {
      tokens.push(token("opname", i, m[0].length, m[1]));
    } else if (rest.startsWith("\\")) {
      m = COMMAND_RE.exec(rest)!;
      tokens.push(token("other", i, m[0].length, m[0]));
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
  /^(?:[a-zA-Z](?:_\{[a-zA-Z0-9]+\}|_[a-zA-Z0-9])?|\\[a-zA-Z]+)$/;

/** Mathquill writes a typed space as `\ `. */
function withoutSpaces(latex: string) {
  return latex.replace(/\\ |\s/g, "");
}

/**
 * The function name at the start of `latex` if it's followed by `\left(`:
 * an identifier, or a multi-character name (`area`, `\operatorname{area}`,
 * `\operatorname{ar}ea`). Returns the display name and its length in `latex`.
 */
function leadingName(latex: string) {
  const word = WORD_BEFORE_PAREN_RE.exec(latex);
  if (word && isMultiChar(wordName(word[0])))
    return { display: wordName(word[0]), length: word[0].length };
  const ident = IDENT_RE.exec(latex);
  if (ident && latex.startsWith("\\left(", ident[0].length))
    return { display: ident[0], length: ident[0].length };
  return undefined;
}

/** Recognize `name\left(p_1,...,p_n\right)=` at the start of `latex`. */
export function parseDefinitionLHS(latex: string): DefinitionLHS | undefined {
  const s = latex.trimStart();
  const name = leadingName(s);
  if (!name) return undefined;
  const argList = parseArgs(s, name.length);
  if (!argList || argList.args.length === 0) return undefined;
  if (!argList.args.every((a) => PARAM_RE.test(withoutSpaces(a))))
    return undefined;
  if (!withoutSpaces(s.slice(argList.end)).startsWith("=")) return undefined;
  return { display: name.display, arity: argList.args.length };
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

/**
 * The identifier defined by `latex`, if it's an assignment `a_{1}=...` or a
 * function definition `f\left(x\right)=...`.
 */
export function definedIdentifier(latex: string): string | undefined {
  const s = latex.trimStart();
  const m = IDENT_RE.exec(s);
  if (!m) return undefined;
  const end = parseArgs(s, m[0].length)?.end ?? m[0].length;
  return withoutSpaces(s.slice(end)).startsWith("=") ? m[0] : undefined;
}

/**
 * Whether `latex` starts with a call-like use of the alias's name, either in
 * stored or displayed form. True even while the arguments are mid-edit.
 */
export function startsWithAliasName(latex: string, alias: FnAlias) {
  const s = latex.trimStart();
  if (s.startsWith(alias.stored + "\\left(")) return true;
  return leadingName(s)?.display === alias.display;
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
