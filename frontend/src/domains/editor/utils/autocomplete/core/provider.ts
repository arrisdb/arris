import type {
  Completion,
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

import { arrisCompletionTheme } from "./theme";

// The result of the `analyze` stage: where the completion replaces from, the
// dialect-specific situation describing what should be suggested, and whether
// CodeMirror should client-side filter the options by the typed prefix.
interface CompletionAnalysis<S> {
  from: number;
  situation: S;
  filter?: boolean;
  // CodeMirror keeps the open menu valid (re-filters in place rather than
  // re-querying) while the typed text still matches this pattern.
  validFor?: RegExp;
}

// One autocomplete flavor, expressed as the same four stages for every dialect:
//   collect + locate  → analyze(cc): CompletionAnalysis | null
//   suggest (ranked)  → suggest(situation, cc): Completion[]
//   output            → postProcess + toSource() (shared glue below)
// Subclasses implement analyze + suggest; the base owns the CodeMirror plumbing
// (null short-circuit, CompletionResult shape, theming). `S` is the dialect's own
// situation type.
abstract class CompletionProvider<S = unknown> {
  protected abstract analyze(cc: CompletionContext): CompletionAnalysis<S> | null;

  protected abstract suggest(situation: S, cc: CompletionContext): Completion[];

  // Output-stage transform applied to the suggested options (e.g. identifier
  // casing). Default: identity.
  protected postProcess(options: Completion[]): Completion[] {
    return options;
  }

  // Whether an empty suggestion list collapses to a null result (no menu). True
  // for path/keyspace providers whose `analyze` can't tell ahead of time that a
  // position yields nothing. The SQL provider sets this false: once its `analyze`
  // commits to a branch it always returns a (possibly empty) result, matching the
  // original cascade.
  protected readonly emptyResultIsNull: boolean = true;

  // Synchronous source: these providers compute completions in-process, so the
  // return type is narrowed from CodeMirror's async-capable `CompletionSource`,
  // so callers (and tests) can read the result without awaiting.
  toSource(): (cc: CompletionContext) => CompletionResult | null {
    return (cc: CompletionContext): CompletionResult | null => {
      const analysis = this.analyze(cc);
      if (!analysis) return null;
      const options = this.postProcess(this.suggest(analysis.situation, cc));
      // No applicable suggestions reads the same as "no completion here".
      if (options.length === 0 && this.emptyResultIsNull) return null;
      return {
        from: analysis.from,
        options,
        filter: analysis.filter ?? true,
        validFor: analysis.validFor,
      };
    };
  }

  extensions(fontSize: number): Extension[] {
    return arrisCompletionTheme(fontSize, this.toSource());
  }
}

export {
  CompletionProvider,
};

export type {
  CompletionAnalysis,
};
