import { Driver, clean, testWithPage } from "#tests";
import { Calc as CalcType } from "#globals";

declare let Calc: CalcType;
declare let Desmos: Window["Desmos"];

async function typeExpression(driver: Driver, latex: string) {
  await driver.dispatch({ type: "new-expression" });
  await driver.setLatexAndSync(latex);
}

async function storedLatexes(driver: Driver) {
  const state = await driver.getState();
  return state.expressions.list.flatMap((e) =>
    e.type === "expression" && e.latex ? [e.latex] : []
  );
}

async function displayedLatex(driver: Driver) {
  return await driver.evaluate(() => {
    const { rootViewNode } = Calc.controller.getSelectedItem()!;
    const mq = rootViewNode.querySelector(".dcg-main .dcg-mq-editable-field");
    return mq ? Desmos.MathQuill.getApiInstanceForElement(mq)?.latex() : "";
  });
}

/** Whether the cursor is directly after the function name. */
async function cursorAfterName(driver: Driver) {
  return await driver.evaluate(() => {
    const mq = Desmos.Private.Fragile.MathquillView.getFocusedMathquill();
    const selection = mq?.selection();
    const index = selection?.headIndex ?? selection?.endIndex;
    return index === mq?.latex().indexOf("\\left(");
  });
}

testWithPage("Overloads by argument count", async (driver) => {
  await driver.enablePlugin("function-aliases");
  await driver.focusIndex(0);
  await driver.setLatexAndSync("C\\left(x\\right)=x");
  await typeExpression(driver, "C\\left(x,y\\right)=x+y");
  await typeExpression(driver, "C\\left(2\\right)+C\\left(3,4\\right)");

  await driver.expectEval("9");
  expect(await displayedLatex(driver)).toBe(
    "C\\left(2\\right)+C\\left(3,4\\right)"
  );
  expect(await storedLatexes(driver)).toEqual([
    "C\\left(x\\right)=x",
    "C_{ov2}\\left(x,y\\right)=x+y",
    "C\\left(2\\right)+C_{ov2}\\left(3,4\\right)",
  ]);

  // Disabling shows the vanilla names, which still evaluate
  await driver.disablePlugin("function-aliases");
  await driver.waitForSync();
  await driver.expectEval("9");
  expect(await displayedLatex(driver)).toBe(
    "C\\left(2\\right)+C_{ov2}\\left(3,4\\right)"
  );

  await driver.clean();
  return clean;
});

testWithPage("Multi-character function names", async (driver) => {
  await driver.enablePlugin("function-aliases");
  await driver.focusIndex(0);
  await driver.setLatexAndSync("area\\left(r\\right)=3r^{2}");
  await typeExpression(driver, "\\operatorname{area}\\left(2\\right)");

  await driver.expectEval("12");
  expect(await storedLatexes(driver)).toEqual([
    "a_{rea}\\left(r\\right)=3r^{2}",
    "a_{rea}\\left(2\\right)",
  ]);

  await driver.clean();
  return clean;
});

testWithPage(
  "Multi-character name containing a defined function",
  async (driver) => {
    // Regression: typed spaces (`\ `) stopped `sdfLine` registering, so Desmos
    // read it as s*d*f*L*i*n*e(...) and complained about `L`.
    await driver.enablePlugin("function-aliases");
    await driver.focusIndex(0);
    await driver.setLatexAndSync("L\\left(a\\right)=a");
    await typeExpression(
      driver,
      "sdfLine\\left(p,\\ a\\right)=L\\left(p\\right)+a"
    );
    await typeExpression(
      driver,
      "\\operatorname{sdfLine}\\left(1,\\ 2\\right)"
    );

    await driver.expectEval("3");
    expect(await storedLatexes(driver)).toEqual([
      "L\\left(a\\right)=a",
      "s_{dfLine}\\left(p,\\ a\\right)=L\\left(p\\right)+a",
      "s_{dfLine}\\left(1,\\ 2\\right)",
    ]);

    await driver.clean();
    return clean;
  }
);

testWithPage(
  "Calls typed before their definition reconnect",
  async (driver) => {
    await driver.enablePlugin("function-aliases");
    await driver.focusIndex(0);
    await driver.setLatexAndSync("area\\left(2\\right)");
    await typeExpression(driver, "area\\left(r\\right)=3r^{2}");
    // Normalizing other expressions happens after the dispatch
    await driver.waitForSync();
    await driver.focusIndex(0);
    await driver.waitForSync();

    await driver.expectEval("12");
    expect(await storedLatexes(driver)).toEqual([
      "a_{rea}\\left(2\\right)",
      "a_{rea}\\left(r\\right)=3r^{2}",
    ]);

    await driver.clean();
    return clean;
  }
);

testWithPage("Renaming a definition in place", async (driver) => {
  // Regression: registering each intermediate name (`sd`, `sdf`, ...) as it
  // was typed redrew the field and sent the cursor to the end.
  await driver.enablePlugin("function-aliases");
  await driver.focusIndex(0);
  await driver.setLatexAndSync("L\\left(a\\right)=a");
  await typeExpression(
    driver,
    "s_{line}\\left(p,\\ a\\right)=L\\left(p\\right)+a"
  );
  await driver.waitForFocusedMathquill();

  await driver.keyboard.press("Home");
  await driver.keyboard.press("ArrowRight");
  for (let i = 0; i < 4; i++) await driver.keyboard.press("Delete");
  await driver.keyboard.type("dfLine");
  await driver.waitForSync();
  // The alias applies straight away, without rewriting the field as typed
  expect(await storedLatexes(driver)).toEqual([
    "L\\left(a\\right)=a",
    "s_{dfLine}\\left(p,\\ a\\right)=L\\left(p\\right)+a",
  ]);
  expect(await cursorAfterName(driver)).toBe(true);
  await driver.keyboard.type("X");
  expect(await cursorAfterName(driver)).toBe(true);
  await driver.keyboard.press("Backspace");
  await driver.waitForSync();
  expect(await storedLatexes(driver)).toEqual([
    "L\\left(a\\right)=a",
    "s_{dfLine}\\left(p,\\ a\\right)=L\\left(p\\right)+a",
  ]);
  await typeExpression(driver, "\\operatorname{sdfLine}\\left(1,\\ 2\\right)");
  await driver.expectEval("3");

  await driver.clean();
  return clean;
});
