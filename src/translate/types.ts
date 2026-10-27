export type IssueLevel = 'error' | 'warn';

/** A single validation finding produced by a pipeline. */
export interface ValidationIssue {
  /** Stable rule identifier, e.g. `md.code-block-count`. */
  rule: string;
  level: IssueLevel;
  message: string;
}
