function copyCompiledSql(compiledSql: string) {
  if (compiledSql) {
    navigator.clipboard.writeText(compiledSql).catch(() => {});
  }
}

export { copyCompiledSql };
