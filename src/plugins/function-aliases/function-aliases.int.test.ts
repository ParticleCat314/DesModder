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
