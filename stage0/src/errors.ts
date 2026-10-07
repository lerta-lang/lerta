export class CompileError extends Error {
  readonly line: number
  readonly column: number

  constructor(message: string, line: number, column: number) {
    super(message)
    this.line = line
    this.column = column
  }

  format(path: string): string {
    return `${path}:${this.line}:${this.column}: ${this.message}`
  }
}
