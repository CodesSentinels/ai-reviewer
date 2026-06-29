import {
  parseImports,
  extractVueScriptContent,
  extractModifiedSymbols,
  findReferencesInContent,
  formatCrossFileContext,
  type ImportInfo,
  type ModifiedSymbol,
  type SymbolReference,
  type FileDependencyInfo
} from '@src/dependency-analyzer'

export type {
  ImportInfo,
  ModifiedSymbol,
  SymbolReference,
  FileDependencyInfo
}

export interface PipelineState {
  vueScriptContent: string
  imports: ImportInfo[]
  symbols: ModifiedSymbol[]
  references: SymbolReference[]
  formattedContext: string
}

export function runPipeline(input: {
  diffPatch: string
  sourceFilename: string
  sourceContent: string
  refFilename: string
  refContent: string
}): PipelineState {
  const isVue = input.sourceFilename.endsWith('.vue')
  const vueScriptContent = isVue
    ? extractVueScriptContent(input.sourceContent)
    : ''

  const contentForImports = isVue ? input.sourceContent : input.sourceContent
  const imports = parseImports(contentForImports, input.sourceFilename)

  const symbols = extractModifiedSymbols(input.sourceFilename, input.diffPatch)

  const exportedSymbolNames = symbols
    .filter(s => s.isExported)
    .map(s => s.name)

  const references =
    exportedSymbolNames.length > 0
      ? findReferencesInContent(
          input.refFilename,
          input.refContent,
          exportedSymbolNames
        )
      : []

  const analysis: FileDependencyInfo = {
    filename: input.sourceFilename,
    modifiedSymbols: symbols.filter(s => s.isExported),
    dependentFiles: references.length > 0 ? [input.refFilename] : [],
    references
  }

  const formattedContext =
    analysis.modifiedSymbols.length > 0
      ? formatCrossFileContext(analysis)
      : ''

  return {vueScriptContent, imports, symbols, references, formattedContext}
}

export {
  parseImports,
  extractVueScriptContent,
  extractModifiedSymbols,
  findReferencesInContent,
  formatCrossFileContext
}
