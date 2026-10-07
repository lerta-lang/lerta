const location = (path: string, line: number, column: number): string => `${path}:${line}:${column}`

// Reported without stopping the compilation.
export class CompileWarning {
  readonly message: string
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    this.message = message
    this.line = line
    this.column = column
  }

  format(path: string): string {
    return `${location(path, this.line, this.column)}: warning: ${this.message}`
  }
}

export class CompileError extends Error {
  readonly line: number
  readonly column: number
  // Warnings found before the error, to be reported along with it.
  warnings: CompileWarning[] = []

  constructor(message: string, line: number, column: number) {
    super(message)
    this.line = line
    this.column = column
  }

  format(path: string): string {
    return `${location(path, this.line, this.column)}: ${this.message}`
  }
}
