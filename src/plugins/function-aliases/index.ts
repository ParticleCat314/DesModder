import { PluginController } from "../PluginController";
import { DispatchedEvent } from "../../globals/extra-actions";
import { MathQuillConfig, MathQuillField } from "#components";
import { getMetadataFromListModel } from "../../core-plugins/manage-metadata/sync";
import {
  DefinitionLHS,
  FnAlias,
  Registry,
  identifiersIn,
  isMultiChar,
  makeStoredName,
  parseDefinitionLHS,
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
    this.refreshMathFieldConfigs();
    this.cc.updateViews();
  }

  afterUpdateTheComputedWorld() {
    this.rebuildRegistry();
  }

  handleDispatchedAction(evt: DispatchedEvent) {
    if (evt.type === "set-item-latex") this.onSetItemLatex(evt);
    return undefined;
  }

  /** Called from the expression list's mathquill `latex` prop. */
  toDisplay(latex: string) {
    return toDisplay(latex, this.registry);
  }

  private onSetItemLatex(evt: { id: string; latex: string }) {
    const def = parseDefinitionLHS(evt.latex);
    const current = this.aliasById.get(evt.id);
    const next = def ? this.aliasFor(evt.id, def, current) : undefined;
    if (!sameAlias(current, next)) {
      this.dsm.metadata?.updateForExprDuringDispatch(evt.id, { fnAlias: next });
      this.rebuildRegistry(evt.id);
    }
    evt.latex = toStored(evt.latex, this.registry);
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

  private takenIdentifiers(id: string) {
    const taken = new Set<string>();
    for (const model of this.cc.getAllItemModels()) {
      if (model.id === id || model.type !== "expression") continue;
      for (const ident of identifiersIn(model.latex ?? "")) taken.add(ident);
    }
    for (const [aliasId, alias] of this.aliasById) {
      if (aliasId !== id) taken.add(alias.stored);
    }
    return taken;
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
   * expression still defines the stored name. `pendingId` is the expression
   * currently being edited, whose model latex is not yet updated.
   */
  private rebuildRegistry(pendingId?: string) {
    const metadata = getMetadataFromListModel(this.calc);
    this.aliasById.clear();
    for (const [id, m] of Object.entries(metadata.expressions)) {
      const alias = m?.fnAlias;
      if (!alias) continue;
      const model = this.cc.getItemModel(id);
      if (model?.type !== "expression") continue;
      if (
        id !== pendingId &&
        !(model.latex ?? "").trimStart().startsWith(alias.stored + "\\left(")
      )
        continue;
      this.aliasById.set(id, alias);
    }
    const aliases = [...this.aliasById.values()];
    const registryKey = JSON.stringify(aliases);
    if (registryKey === this.lastRegistryKey) return;
    this.lastRegistryKey = registryKey;
    this.registry = new Registry(aliases);
    const multiCharKey = [...this.registry.multiCharNames].sort().join(" ");
    if (multiCharKey !== this.lastMultiCharKey) {
      this.lastMultiCharKey = multiCharKey;
      // Defer: mathquill config changes shouldn't happen mid-keystroke.
      setTimeout(() => this.refreshMathFieldConfigs());
    }
  }

  /**
   * Mathquill only reads its config on mount, so push the updated
   * autoOperatorNames into expression fields that are already mounted.
   */
  private refreshMathFieldConfigs() {
    const config: MathQuillConfig = this.cc.getMathquillConfig({
      additionalOperators: [],
    });
    const fields = document.querySelectorAll(
      ".dcg-expressionitem .dcg-mq-editable-field"
    );
    for (const el of fields) {
      const mq = (el as { _mqMathFieldInstance?: MathQuillField })
        ._mqMathFieldInstance;
      mq?.config({ autoOperatorNames: config.autoOperatorNames });
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
