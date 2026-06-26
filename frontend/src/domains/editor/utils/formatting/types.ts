import type { DatabaseKind, FormatterSettings } from "@shared";

interface EditorFormatContext {
  text: string;
  languageId: string;
  connectionKind?: DatabaseKind;
  settings: FormatterSettings;
}

abstract class EditorFormatter {
  readonly languageIds: ReadonlySet<string>;

  protected constructor(languageIds: readonly string[]) {
    this.languageIds = new Set(languageIds);
  }

  supports(languageId: string): boolean {
    return this.languageIds.has(languageId);
  }

  abstract format(context: EditorFormatContext): string;
}

export {
  EditorFormatter,
};

export type {
  EditorFormatContext,
};
