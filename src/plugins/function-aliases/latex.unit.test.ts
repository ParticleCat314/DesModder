import {
  Registry,
  definedIdentifier,
  makeStoredName,
  parseArgs,
  parseDefinitionLHS,
  startsWithAliasName,
  toDisplay,
  toStored,
} from "./latex";

const registry = new Registry([
  { display: "C", arity: 2, stored: "C_{ov2}" },
  { display: "C", arity: 3, stored: "C_{ov3}" },
  { display: "area", arity: 1, stored: "a_{rea}" },
  { display: "f_{a}", arity: 2, stored: "f_{aov2}" },
]);

describe("parseArgs", () => {
  const cases: [string, string[] | undefined][] = [
    ["\\left(\\right)", []],
    ["\\left(x\\right)", ["x"]],
    ["\\left(x,y\\right)", ["x", "y"]],
    ["\\left(\\left(1,2\\right)\\right)", ["\\left(1,2\\right)"]],
    ["\\left(\\left[1,2,3\\right],4\\right)", ["\\left[1,2,3\\right]", "4"]],
    ["\\left(\\frac{a,b}{2},3\\right)", ["\\frac{a,b}{2}", "3"]],
    [
      "\\left(\\left\\{x>0:1,2\\right\\},y\\right)",
      ["\\left\\{x>0:1,2\\right\\}", "y"],
    ],
    ["\\left(x,y", undefined],
    ["x", undefined],
  ];
  for (const [latex, expected] of cases) {
    test(latex, () => {
      expect(parseArgs(latex, 0)?.args).toEqual(expected);
    });
  }
});

describe("parseDefinitionLHS", () => {
  const cases: [string, ReturnType<typeof parseDefinitionLHS>][] = [
    ["C\\left(x\\right)=x", { display: "C", arity: 1 }],
    ["C\\left(x,y\\right)=x+y", { display: "C", arity: 2 }],
    ["f_{a}\\left(x,y\\right)=1", { display: "f_{a}", arity: 2 }],
    [
      "\\operatorname{area}\\left(r\\right)=\\pi r^{2}",
      { display: "area", arity: 1 },
    ],
    ["area\\left(r\\right)=\\pi r^{2}", { display: "area", arity: 1 }],
    ["g\\left(\\theta\\right)=\\theta", { display: "g", arity: 1 }],
    // typed spaces
    [
      "\\operatorname{sdfLine}\\left(p,\\ a,\\ b\\right)\\ =p",
      { display: "sdfLine", arity: 3 },
    ],
    ["sdfLine\\left(p,\\ a\\right)=p+a", { display: "sdfLine", arity: 2 }],
    // letters typed after a known name
    [
      "\\operatorname{sdf}Line\\left(p\\right)=p",
      { display: "sdfLine", arity: 1 },
    ],
    [
      "s\\operatorname{df}L\\operatorname{ine}\\left(p\\right)=p",
      { display: "sdfLine", arity: 1 },
    ],
    ["C\\left(2\\right)=x", undefined],
    ["C\\left(x\\right)", undefined],
    ["C\\left(\\right)=1", undefined],
    ["y=C\\left(x\\right)", undefined],
  ];
  for (const [latex, expected] of cases) {
    test(latex, () => {
      expect(parseDefinitionLHS(latex)).toEqual(expected);
    });
  }
});

describe("toStored / toDisplay", () => {
  const cases: [string, string][] = [
    // overloads by arity; arity 1 has no alias so stays plain
    [
      "C\\left(1\\right)+C\\left(1,2\\right)+C\\left(1,2,3\\right)",
      "C\\left(1\\right)+C_{ov2}\\left(1,2\\right)+C_{ov3}\\left(1,2,3\\right)",
    ],
    ["C\\left(x,y\\right)=x+y", "C_{ov2}\\left(x,y\\right)=x+y"],
    // nested calls
    [
      "C\\left(C\\left(1,2\\right),3\\right)",
      "C_{ov2}\\left(C_{ov2}\\left(1,2\\right),3\\right)",
    ],
    // a point argument counts as one argument
    [
      "C\\left(\\left(1,2\\right)\\right)",
      "C\\left(\\left(1,2\\right)\\right)",
    ],
    // multi-character names
    [
      "\\operatorname{area}\\left(r\\right)=\\pi r^{2}",
      "a_{rea}\\left(r\\right)=\\pi r^{2}",
    ],
    ["2\\operatorname{area}\\left(3\\right)", "2a_{rea}\\left(3\\right)"],
    // subscripted names
    ["f_{a}\\left(1,2\\right)", "f_{aov2}\\left(1,2\\right)"],
    // untouched
    ["C+x", "C+x"],
    ["\\sin\\left(x\\right)", "\\sin\\left(x\\right)"],
    [
      "\\operatorname{mod}\\left(x,2\\right)",
      "\\operatorname{mod}\\left(x,2\\right)",
    ],
  ];
  for (const [display, stored] of cases) {
    test(`toStored ${display}`, () => {
      expect(toStored(display, registry)).toBe(stored);
    });
    test(`round trip ${display}`, () => {
      expect(toDisplay(toStored(display, registry), registry)).toBe(display);
    });
  }

  test("bare letters before a paren are recognized for registered names", () => {
    expect(toStored("area\\left(1\\right)", registry)).toBe(
      "a_{rea}\\left(1\\right)"
    );
    expect(toStored("xarea\\left(1\\right)", registry)).toBe(
      "xa_{rea}\\left(1\\right)"
    );
    expect(toStored("ab\\left(1\\right)", registry)).toBe("ab\\left(1\\right)");
  });

  test("names split into upright and plain parts are recognized", () => {
    expect(toStored("\\operatorname{ar}ea\\left(1\\right)", registry)).toBe(
      "a_{rea}\\left(1\\right)"
    );
    expect(toStored("2\\operatorname{are}a\\left(1\\right)", registry)).toBe(
      "2a_{rea}\\left(1\\right)"
    );
  });

  test("unknown arity is left alone", () => {
    expect(toStored("\\operatorname{area}\\left(1,2\\right)", registry)).toBe(
      "\\operatorname{area}\\left(1,2\\right)"
    );
  });

  test("empty registry is identity", () => {
    const empty = new Registry([]);
    expect(toStored("C\\left(1,2\\right)", empty)).toBe("C\\left(1,2\\right)");
    expect(toDisplay("C_{ov2}\\left(1,2\\right)", empty)).toBe(
      "C_{ov2}\\left(1,2\\right)"
    );
  });
});

describe("makeStoredName", () => {
  test("names", () => {
    const none = new Set<string>();
    expect(makeStoredName("C", 2, true, none)).toBe("C_{ov2}");
    expect(makeStoredName("f_{a}", 2, true, none)).toBe("f_{aov2}");
    expect(makeStoredName("area", 1, false, none)).toBe("a_{rea}");
    expect(makeStoredName("area", 2, true, none)).toBe("a_{reaov2}");
  });
  test("collisions", () => {
    const taken = new Set(["C_{ov2}", "C_{ov21}"]);
    expect(makeStoredName("C", 2, true, taken)).toBe("C_{ov22}");
  });
});

describe("definedIdentifier", () => {
  test("definitions", () => {
    expect(definedIdentifier("a_{1}=3")).toBe("a_{1}");
    expect(definedIdentifier("s_{dfLine}\\left(p,\\ a\\right)=p")).toBe(
      "s_{dfLine}"
    );
    expect(definedIdentifier("s_{dfLine}\\left(1\\right)")).toBe(undefined);
    expect(definedIdentifier("y=x")).toBe("y");
  });
});

describe("startsWithAliasName", () => {
  const alias = { display: "sdfLine", arity: 2, stored: "s_{dfLine}" };
  test("matches stored, displayed and bare forms mid-edit", () => {
    expect(startsWithAliasName("s_{dfLine}\\left(p,\\right)", alias)).toBe(
      true
    );
    expect(
      startsWithAliasName("\\operatorname{sdfLine}\\left(p,\\right)=", alias)
    ).toBe(true);
    expect(startsWithAliasName("sdfLine\\left(p,\\right)", alias)).toBe(true);
    expect(
      startsWithAliasName("\\operatorname{sdf}Line\\left(p,\\right)", alias)
    ).toBe(true);
    expect(startsWithAliasName("sdfLin\\left(p\\right)=1", alias)).toBe(false);
  });
});
