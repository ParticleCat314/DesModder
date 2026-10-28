export default interface Metadata {
  version: 2;
  expressions: Record<string, Expression | undefined>;
}

export interface Expression {
  pinned?: boolean;
  errorHidden?: boolean;
  glesmos?: boolean;
  glesmosLinesConfirmed?: boolean;
  /** Set by function-aliases on the expression defining an aliased function */
  fnAlias?: {
    display: string;
    arity: number;
    stored: string;
  };
}
