// The classes and structs of the program: their fields and methods. Like functions, they can be
// used anywhere in the module, so the types of fields given by an initializer alone are found on
// demand.
import type {
  Expression,
  FunctionLiteral,
  Identifier,
  MemberDeclaration,
  Position,
  TypeDeclaration,
} from '../syntax/ast.ts'
import { CompileError } from '../errors.ts'
import { method_key, type Functions } from './functions.ts'
import { is_builtin_type_name, type TypeResolver } from './type_names.ts'
import type { Type } from '../types.ts'

export type FieldInfo = {
  name: Identifier
  // Undefined until found, for a field given by an initializer alone.
  type: Type | undefined
  mutable: boolean
  // A field without an initializer is a constructor argument.
  value: Expression | undefined
}

export type ObjectInfo = {
  declaration: TypeDeclaration
  type: Type
  fields: FieldInfo[]
  methods: Map<string, FunctionLiteral>
  // Those of the declaring module, which hold the methods' types; set by add_members.
  functions: Functions | undefined
  has_init: boolean
  state: 'unchecked' | 'checking' | 'checked'
}

const is_method = (member: MemberDeclaration): boolean =>
  member.value?.kind === 'function' && member.modifier !== 'var'

export class ObjectTypes {
  // The classes and structs that the module declares.
  private readonly infos = new Map<string, ObjectInfo>()
  // Those of every module checked so far, by symbol: a value may have a type that the module does
  // not name.
  private readonly program_infos: Map<string, ObjectInfo>
  private readonly module_index: number
  private readonly module_name: string
  // Checks the initializers of the fields, setting the types that they give.
  private readonly check_initializers: (info: ObjectInfo) => void
  // A class or struct that the module imports, marking the import as used.
  private readonly imported: (name: string) => ObjectInfo | undefined

  constructor(
    check_initializers: (info: ObjectInfo) => void,
    imported: (name: string) => ObjectInfo | undefined,
    program_infos: Map<string, ObjectInfo>,
    module_index: number,
    module_name: string,
  ) {
    this.module_index = module_index
    this.module_name = module_name
    this.check_initializers = check_initializers
    this.imported = imported
    this.program_infos = program_infos
  }

  // Registers the names first, so that the members can refer to any of the types.
  add(declarations: TypeDeclaration[]): void {
    for (const declaration of declarations) {
      const { name, is_struct } = declaration
      if (this.infos.has(name.name) || is_builtin_type_name(name.name)) {
        throw new CompileError(`'${name.name}' is already defined`, name.line, name.column)
      }
      const symbol = `${this.module_index}.${name.name}`
      const type: Type = {
        kind: 'Object',
        name: name.name,
        symbol,
        module: this.module_name,
        is_struct,
      }
      const info: ObjectInfo = {
        declaration,
        type,
        fields: [],
        methods: new Map(),
        functions: undefined,
        has_init: false,
        state: 'unchecked',
      }
      this.infos.set(name.name, info)
      this.program_infos.set(symbol, info)
    }
  }

  // Resolves the written field types and adds the methods to `functions`.
  add_members(resolver: TypeResolver, functions: Functions): void {
    for (const info of this.infos.values()) {
      info.functions = functions
      const seen = new Set<string>()
      for (const member of info.declaration.members) {
        const { name } = member.name
        if (seen.has(name)) {
          const message = `'${name}' is already a member of ${info.declaration.name.name}`
          throw new CompileError(message, member.name.line, member.name.column)
        }
        seen.add(name)
        if (is_method(member)) this.add_method(info, member, functions)
        else info.fields.push(this.field(info, member, resolver))
      }
    }
  }

  private add_method(info: ObjectInfo, member: MemberDeclaration, functions: Functions): void {
    const literal = member.value as FunctionLiteral
    const type_name = info.declaration.name.name
    if (member.name.name === 'init') {
      if (literal.params.length > 0) {
        throw new CompileError('init takes no parameters', literal.line, literal.column)
      }
      info.has_init = true
    }
    info.methods.set(member.name.name, literal)
    functions.add(method_key(type_name, member.name.name), member.name, literal, info.type)
  }

  private field(info: ObjectInfo, member: MemberDeclaration, resolver: TypeResolver): FieldInfo {
    const { is_struct } = info.declaration
    if (member.value?.kind === 'function') {
      const message = 'a function field is not supported yet; a method is written without var'
      throw new CompileError(message, member.line, member.column)
    }
    if (is_struct && member.modifier === 'var') {
      throw new CompileError('a struct field cannot be var', member.line, member.column)
    }
    return {
      name: member.name,
      type: member.type === undefined ? undefined : resolver.resolve(member.type),
      mutable: !is_struct && member.modifier !== 'const',
      value: member.value,
    }
  }

  object_type(name: string): Type | undefined {
    return (this.infos.get(name) ?? this.imported(name))?.type
  }

  info(type: Type): ObjectInfo {
    if (type.kind !== 'Object') throw new Error('expected a class or struct type')
    return this.program_infos.get(type.symbol)!
  }

  // The classes and structs that the module declares.
  all(): ObjectInfo[] {
    return [...this.infos.values()]
  }

  // The field's type, checking the initializers first if it is given by one alone.
  field_type(info: ObjectInfo, field: FieldInfo, at: Position): Type {
    if (field.type !== undefined) return field.type
    if (info.state === 'checking') {
      const message = `the type of '${field.name.name}' is not known yet; write it`
      throw new CompileError(message, at.line, at.column)
    }
    this.check(info)
    return field.type!
  }

  check_all(): void {
    for (const info of this.infos.values()) this.check(info)
  }

  private check(info: ObjectInfo): void {
    if (info.state !== 'unchecked') return
    info.state = 'checking'
    this.check_initializers(info)
    info.state = 'checked'
  }
}
