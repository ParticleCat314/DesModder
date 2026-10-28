import { PluginController } from "../PluginController";
import { DispatchedEvent } from "../../globals/extra-actions";
import { MathQuillField, MathQuillView } from "#components";
import { getMetadataFromListModel } from "../../core-plugins/manage-metadata/sync";
import {
  DefinitionLHS,
  FnAlias,
  Registry,
  definedIdentifier,
  isMultiChar,
  makeStoredName,
  parseDefinitionLHS,
  startsWithAliasName,
  toDisplay,
  toStored,
} from "./latex";

/**
 * Function overloading and multi-character function names.
 *
 * The graph stores vanilla identifiers (`C_{ov2}`, `a_{rea}`), so graphs keep
 * working without DesModder. The expression list displays and accepts the
 * real names (`C`, `\operatorname{area}`).
 *
 * Each alias is recorded in the metadata of the expression that defines it.
 */
export default class FunctionAliases extends PluginController {
  static id = "function-aliases" as const;
  static enabledByDefault = false;

  registry = new Registry([]);
  private readonly aliasById = new Map<string, FnAlias>();
  private lastRegistryKey = "";
  private lastMultiCharKey = "";
  private readonly vanillaGetMathquillConfig = this.cc.getMathquillConfig;
  private wrappedGetMathquillConfig?: typeof this.cc.getMathquillConfig;
  /** The focused field doesn't get new names until it loses focus, since
   * reconfiguring it can redraw it and lose the cursor. */
  private focusedMq?: MathQuillField;

  afterEnable() {
    const prev = this.cc.getMathquillConfig;
    this.wrappedGetMathquillConfig = (e) =>
      prev.call(this.cc, {
        ...e,
        additionalOperators: [
          ...(e?.additionalOperators ?? []),
          ...this.registry.multiCharNames,
        ],
      });
    this.cc.getMathquillConfig = this.wrappedGetMathquillConfig;
    this.rebuildRegistry();
    this.cc.updateViews();
  }

  afterDisable() {
    this.registry = new Registry([]);
    this.aliasById.clear();
    // Another plugin (custom-mathquill-config) may have wrapped on top of us.
    // In that case, our wrapper stays but passes through an empty name list.
    if (this.cc.getMathquillConfig === this.wrappedGetMathquillConfig) {
      this.cc.getMathquillConfig = this.vanillaGetMathquillConfig;
    }
    this.focusedMq = undefined;
    this.refreshMathFieldConfigs(true);
    this.cc.updateViews();
  }

  afterUpdateTheComputedWorld() {
    this.rebuildRegistry();
  }

  handleDispatchedAction(evt: DispatchedEvent) {
    if (evt.type === "set-item-latex") this.onSetItemLatex(evt);
    return undefined;
  }

  afterHandleDispatchedAction() {
    const mq = MathQuillView.getFocusedMathquill();
    if (mq === this.focusedMq) return;
    this.focusedMq = mq;
    setTimeout(() => this.refreshMathFieldConfigs());
  }

  /** Called from the expression list's mathquill `latex` prop. */
  toDisplay(latex: string) {
    // Leave the focused field as typed (e.g. `sdfLine` or
    // `\operatorname{sdf}Line`) if it means the same thing. Otherwise Desmos
    // would rewrite it and move the cursor to the end.
    const typed = MathQuillView.getFocusedMathquill()?.latex();
    if (typed !== undefined && toStored(typed, this.registry) === latex)
      return typed;
    return toDisplay(latex, this.registry);
  }

  private onSetItemLatex(evt: { id: string; latex: string }) {
    const def = parseDefinitionLHS(evt.latex);
    const current = this.aliasById.get(evt.id);
    let next: FnAlias | undefined;
    if (def) next = this.aliasFor(evt.id, def, current);
    // Keep the alias through intermediate edits like `area(r,` so it
    // doesn't flicker or get renamed.
    else if (current && startsWithAliasName(evt.latex, current)) next = current;
    if (!sameAlias(current, next)) {
      this.dsm.metadata?.updateForExprDuringDispatch(evt.id, { fnAlias: next });
      if (this.rebuildRegistry(evt.id)) {
        // Can't dispatch during a dispatch.
        setTimeout(() => this.normalizeOtherExpressions(evt.id));
      }
    }
    evt.latex = toStored(evt.latex, this.registry);
  }

  /**
   * Re-apply the registry to expressions other than `id`. Calls typed before
   * their definition (or before a matching arity existed) are saved with
   * their displayed name, and need rewriting once it's defined.
   */
  private normalizeOtherExpressions(id: string) {
    for (const model of this.cc.getAllItemModels()) {
      if (model.id === id || model.type !== "expression") continue;
      const latex = model.latex ?? "";
      const display = toDisplay(latex, this.registry);
      if (toStored(display, this.registry) === latex) continue;
      // Dispatch the displayed form so `onSetItemLatex` treats it like an edit.
      this.cc.dispatch({
        type: "set-item-latex",
        id: model.id,
        latex: display,
      });
    }
  }

  private aliasFor(
    id: string,
    def: DefinitionLHS,
    current: FnAlias | undefined
  ): FnAlias | undefined {
    const multi = isMultiChar(def.display);
    if (multi && this.isBuiltinName(def.display)) {
      setTimeout(() =>
        this.util.showToast({
          message: {
            key: "function-aliases-builtin-name",
            args: { name: def.display },
          },
        })
      );
      return undefined;
    }
    const overloaded = this.otherDefinitions(id).some(
      (o) => o.display === def.display && o.arity !== def.arity
    );
    if (current?.display === def.display && current.arity === def.arity) {
      return current;
    }
    // Keep a single-letter function plain until it actually becomes
    // overloaded, so graphs without overloads are unchanged.
    if (!multi && !overloaded && current?.display !== def.display) {
      return undefined;
    }
    const stored = makeStoredName(
      def.display,
      def.arity,
      !multi || overloaded,
      this.takenIdentifiers(id)
    );
    return { display: def.display, arity: def.arity, stored };
  }

  /** Function definitions in every expression except `id`. */
  private otherDefinitions(id: string): DefinitionLHS[] {
    const defs: DefinitionLHS[] = [];
    for (const model of this.cc.getAllItemModels()) {
      if (model.id === id || model.type !== "expression") continue;
      const alias = this.aliasById.get(model.id);
      const def = alias ?? parseDefinitionLHS(model.latex ?? "");
      if (def) defs.push(def);
    }
    return defs;
  }

  /**
   * Identifiers defined by other expressions. Identifiers that are only
   * referenced are free to use, so dangling calls to a previous alias
   * reconnect when it's redefined.
   */
  private takenIdentifiers(id: string) {
    const taken = new Set<string>();
    for (const model of this.cc.getAllItemModels()) {
      if (model.id === id || model.type !== "expression") continue;
      const ident = definedIdentifier(model.latex ?? "");
      if (ident) taken.add(ident);
    }
    for (const [aliasId, alias] of this.aliasById) {
      if (aliasId !== id) taken.add(alias.stored);
    }
    return taken;
  }

  private autoOperatorNames(names: Iterable<string>) {
    return this.vanillaGetMathquillConfig.call(this.cc, {
      additionalOperators: [...names],
    }).autoOperatorNames;
  }

  private isBuiltinName(name: string) {
    const names =
      this.vanillaGetMathquillConfig
        .call(this.cc, { additionalOperators: [] })
        .autoOperatorNames?.split(/[\s|]+/) ?? [];
    return names.includes(name);
  }

  /**
   * Rebuild the registry from the metadata note, keeping only aliases whose
   * expression still starts with the aliased name. `pendingId` is the expression
   * currently being edited, whose model latex is not yet updated.
   * Returns whether the registry changed.
   */
  private rebuildRegistry(pendingId?: string): boolean {
    const metadata = getMetadataFromListModel(this.calc);
    this.aliasById.clear();
    for (const [id, m] of Object.entries(metadata.expressions)) {
      const alias = m?.fnAlias;
      if (!alias) continue;
      const model = this.cc.getItemModel(id);
      if (model?.type !== "expression") continue;
      if (id !== pendingId && !startsWithAliasName(model.latex ?? "", alias))
        continue;
      this.aliasById.set(id, alias);
    }
    const aliases = [...this.aliasById.values()];
    const registryKey = JSON.stringify(aliases);
    if (registryKey === this.lastRegistryKey) return false;
    this.lastRegistryKey = registryKey;
    this.registry = new Registry(aliases);
    const multiCharKey = [...this.registry.multiCharNames].sort().join(" ");
    if (multiCharKey !== this.lastMultiCharKey) {
      this.lastMultiCharKey = multiCharKey;
      setTimeout(() => this.refreshMathFieldConfigs());
    }
    return true;
  }

  /**
   * Mathquill only reads its config on mount, so push the updated
   * autoOperatorNames into expression fields that are already mounted.
   */
  private refreshMathFieldConfigs(includeFocused = false) {
    const autoOperatorNames = this.autoOperatorNames(
      this.registry.multiCharNames
    );
    const fields = document.querySelectorAll(
      ".dcg-expressionitem .dcg-mq-editable-field"
    );
    for (const el of fields) {
      const mq = (el as { _mqMathFieldInstance?: MathQuillField })
        ._mqMathFieldInstance;
      if (!mq) continue;
      if (!includeFocused && mq === MathQuillView.getFocusedMathquill())
        continue;
      mq.config({ autoOperatorNames });
    }
  }
}

function sameAlias(a: FnAlias | undefined, b: FnAlias | undefined) {
  return (
    a?.display === b?.display &&
    a?.arity === b?.arity &&
    a?.stored === b?.stored
  );
}
