# Compiler

## Modules

- A module's symbols are named by its path, rather than by its place among the modules, which changes as others are added:
  - from the entry module's directory (absolute if it is on another root, such as another drive): `lerta.fn.ast.lerta.parse`;
  - `std:name` for a standard module;
  - `./` and its file name for the entry module, which no other path starts with: `lerta.fn../main.lerta.main`.
- Names are quoted in the IR, with the bytes other than printable ASCII, `"` and `\` escaped as in strings.

### Top-level values

- Reading a top-level value through a function before it is initialized is detected with an initialized flag, and so is reading an imported value of a module of the same import cycle.
- The check is optimized away where initialization is certain: in top-level code, for the module's own values and those of modules outside the cycle, which have run.
- A function always checks, since a `deinit` can run while the values are released at exit, each unset before its release.
- A `const` whose value is a literal or a constant expression of its own type is read as that value, in place, in its module and in others, never through its global (`constant_of` in `compiler/codegen/top_level.lerta`).
- The checker evaluates constant expressions in the compiler's own arithmetic of their types, as the program would, catching the `ArithmeticError` it throws for a compile error (`compiler/checker/constants.lerta`). It records their values in its facts, which codegen writes in their places; a top-level const's value goes with its local and its export.

### Checking order

- The checker checks the modules step by step, each step for all of them before the next, so that the modules of a cycle can use each other's names:
  1. their names;
  2. their declarations;
  3. their extends (those of the modules of the cycle that run later last);
  4. their top-level code, in the order it runs;
  5. the bodies of their functions and the initializers of their fields.
- An export is worked out when an importer asks for it, and an inferred type on demand, across modules as within one.

## Generics

- Each module emits the instances that it uses, as `linkonce_odr`, so that the linker keeps one of each (see [per-module output](architecture.md#per-module-output)): those that its code names, and those that their bodies name in turn.
  - Instances of generic functions and methods, and of generic classes and structs: their layouts, constructors and types.
- An instance's body sees the names of the module that declares the generic one.
- An instance is named by the function's and the type arguments' names (`lerta.fn.std:builtins/text.print<Int>`), and for a method, the receiver's too (`lerta.extend.std:builtins/collections.Self.map<Array<Int>, Int, String>`).
- An instance checks the function literal with the type parameters standing for its type arguments, and keeps the types and other facts of the literal's nodes apart from those of the other instances.
- **Witnesses.** Besides its module's extends, an instance's body sees (`add_witnesses` in `compiler/checker/generic_call.lerta`):
  - the methods of the extends in effect at the call that satisfy the bounds;
  - in turn, those that satisfy the bounds of a generic method that satisfies a bound's member, an extend's or a class's or struct's own.
  - Instances of the same type arguments whose witnesses differ are told apart by a number after the name.

### Checking a definition

- A generic function's body is checked once at its definition (`check_definition` in `compiler/checker/generics.lerta`): before its first instance, or, for one that no call instantiates, after the instances of every module.
- Each type parameter is then a `TypeParameterType` that is `standing`: a type of its own, which no type pattern binds, whose members come from its bound by `Resolver.bounds` (`bound_method` in `compiler/checker/member.lerta`), as an interface value's do.
- An error there is the generic's, and its instances are not checked.
- What that check finds goes to its own `Definition.facts`, which codegen never reads:
  - a call of a generic function with standing type arguments makes no instance but a signature: the callee's definition with the type arguments put in (`signature`, `substitute_standing`);
  - an instance of a generic class or struct of standing type arguments is a view kept apart from the instances (`ObjectInfo.standing`);
  - the type names it resolves are not recorded for an editor.

## Intrinsics

`intrinsic name` declares a function that the compiler gives, as it cannot be written in Lerta: `assert`, `dbg` and `print_trace` of std:builtins, `encode_value` and `decode_value` of std:codable, and `parse` and `members` of std:enums (`compiler/checker/intrinsics.lerta`). `intrinsic name: Type` declares a value that the compiler gives, as only the build knows it: `optimized` of std:process, and `platform`, of std:internal/platform, which std:process exports and std:io reads (`VALUE_INTRINSICS`). `platform` is the member of its enum that the target's system names, which the enum must have for each system; a build for no target, as dump-llvm's, and so the seed, which builds on every system, reads it where the code runs (`lerta_platform_member`).

- Only a standard module declares one, and only of a name that the compiler knows, a value of the type that the compiler gives it. Its name is imported and exported as an extern's is, and a name of the module's own hides it.
- A read of a value is typed as its declaration says and recorded (`NodeFacts.intrinsic_values`), as the checker, which `fmt` and the language server run too, knows no build; codegen writes the value of the build in its place, so that an optimized build folds what it decides.
- A call of one is checked as the code that the checker makes in its place, in the scope of the call, so that what follows sees its locals and its narrowings; codegen generates that code (`NodeFacts.intrinsic_calls`).
  - Its locals have names that no source can write, of the call's position, as `assert@4:1.left`. They are defined as they are typed, not checked as declarations, which at the top level would take a function for one of the module's own.
  - The `throw` that it makes is marked as an assertion's: it takes the message, a `String`, and throws an `AssertionError` of it, which the checker could not construct by its name, as a program may take the name.
- The message quotes the call from the source, which the loader keeps (`Module.source`), lexed again.
- `assert c` is `if not c` followed by that `throw`, so that what follows is narrowed as after a guard. Of a comparison or an `is` test, or one that `not` negates, as `x is not T` is read, the test is checked first, as any is, with a copy of each path, which the guard checks itself; then each operand that the message shows, no literal and no path, is held first, in a local of the type that the check gave it, and the guard's test converts the local where the check converted the operand. The message, made in the branch where `c` fails, reads them again.
- `encode_value` and `decode_value` are checked as calls of the code that codegen makes for each type (see [representation](representation.md)), with no code in their place.
- `parse` and `members` are too, of the enum (`EnumQuery`): codegen makes `parse` as the decoders read a member, through `lerta_enum_parse` and the table of the members' texts, and `members` as an array of the members' values, 0 up to their count. Where the generic is checked as it stands, the enum is a type parameter that `Enum` bounds.
- `dbg(x)` holds `x`, typed where the call's value is expected, writes the line through `lerta_print_stderr` of std:builtins, whose reference the checker records itself, as a name of the program's own could hide it, and gives the local as the call's value.
- `print_trace(error)` calls `lerta_print_trace` with the error as an interface value, which no extern can take, typed and recorded by the checker as `dbg`'s call is: the C function takes its data and itab, and writes the trace only if the one that the runtime keeps is of that data.

## Defaults

- A function with [defaults](../reference/functions.md) takes every argument.
- For each number of arguments that a call may give, it has an entry, `<symbol>.given<k>`, which computes the defaults of the others and calls it. A call that leaves arguments out calls the entry.
  - An instance of a generic function has them only if a call leaves arguments out, as only such a call has its defaults checked (`defaults_checked`).
- The function's value and the itabs refer to the function itself, which a default does not change.
- A constructor instead takes, after each argument with a [`default`](../reference/objects.md#members), an `i1` of whether it is given, and computes the default of one not given in its place among the initializers.

## Formatter

`lerta fmt` (`compiler/format/`) decides each gap between the tokens and the comments of the source, which it reports with the rule of the decision where the source differs:

- **Rewrites.** Before them, `format/rewrites.lerta` finds the rewrites of tokens that do not depend on the layout, each an edit of the source under its rule (`format/edits.lerta`): a function for each rule, those of parentheses in `parentheses.lerta` and of negations in `conditions.lerta`, over the tokens of `tokens.lerta`. Those that need types, in `typed.lerta`, read the facts that the checker records of the nodes that the formatter parsed, which `load_modules` takes as the entry module, and the imports that it never uses; a program that does not check gets none of them. Each edit is reported where it is, and the layout of the innermost statement that holds one only once it is rewritten. The edits that overlap none apply together, and the source is parsed again and laid out for those that they enable, round after round until none is found and the layout keeps the source, for at most 32 rounds; those of a `;` go after the layout, which keeps no statement on a line that holds one. Each round checks that the rewrites that keep the syntax tree do, and the layout that it keeps the tree.
- **Types left out.** In `format/annotations.lerta`, a written type is a candidate where its value has it of its own (`declared_inferable` and `return_inferable` of `format/inferable.lerta`), or, for a parameter, where the checker records it inferable (`inferable_parameters`). A value that holds a part that another rewrite writes without what the type expected of it shows, as `{ x: 1 }` for `Point(x: 1)`, keeps the type for that round, and the next judges it anew. Once the rounds end, the types of the declarations and the function literals of the program rewritten, checked again, must be those of the source; where they are not, or where it does not check, the rounds run again without leaving out any type (`rewritten_text` in `format/format.lerta`).
- **Walk.** The first pass walks the syntax tree over the tokens and decides the gaps between them: the spaces inside a statement and the line start of each statement with its depth (`format/walk.lerta`, whose walker `walk_statements.lerta`, `walk_expressions.lerta` and `walk_lists.lerta` extend, asking `forms.lerta` about the syntax).
- **Lines.** Between them, `format/lines.lerta` breaks and joins the lines of each statement that the walk handles, top-down: the walk records the constructs that may break a line (`format/shapes.lerta`), and each stays on its line if it fits there from where it starts, and otherwise breaks by its rule, which its findings name. A statement that only a rewrite of its tokens would lay out, as one of the commas between items, the parentheses of a call, the brackets of a literal, the `then` of an arm or the postfix form of a statement, keeps its gaps as written, and the rewrite is found as an edit (`format/lines_edits.lerta`), which the rounds apply with the others; only the first of a statement applies in a round, as the source that another would change may be laid out otherwise once it applies, and where a rewrite would take out a comment, it is only reported.
- **Layout.** The second decides the gaps between the tokens and the comments, the indentation and the blank lines (`format/format.lerta`).
- A statement that holds a construct that the walk does not handle yet keeps its gaps as written, as does one that [`# fmt: skip` or `# fmt: off`](../reference/compiler.md#code-kept-as-written) marks: the walk asks `format/kept.lerta` about each statement on lines of its own once it has walked those inside it, which claim their marked lines first.

## The language server

`lerta lsp` is in `compiler/lsp/`.

- **Messages.** It reads each message's `method` and `id` first, as a `Header`, then decodes it again as a `Request<P>` or a `Notification<P>` of the method's params, with `std:json` in camel case (`protocol.lerta`).
- **Open documents.** Their texts are in `open_texts` of `compiler/source.lerta`, keyed by the real paths of their files, or by the path for one that is no file yet (`text_key`). `read_source` reads them in place of the files, so that the loader, the checker and the formatter take them as files.
- **Checks** (`diagnostics.lerta`):
  - It loads the program whose entry module is the document, each module with the statements that parse, in blocks too (`load_modules_partially`, `TokenStream.block_errors`), and checks it as `lerta build` does.
  - Warnings come through `check_modules`'s callback; errors from the `CompileError`, whose `errors` give them where they are found.
  - A file whose statements do not all parse has only its parse errors, since the checker's would mostly be of the names that the unparsed statements declare.
  - The server keeps what each open document's last check found of each file of its program (`server.lerta`), and publishes a file's diagnostics as those of all of them.
  - It keeps each open document's program of its last check whose modules loaded, so that while a text does not load, as one being written, hover and going to a definition answer from the text before it, for the names that the new text still writes where they were.
- **Hover and definitions** (`locate.lerta`) look among the names of the facts of the module's code, and of the instances of its generic functions and classes, for those whose text the source writes at the position.
  - The checker records each expression's type, a name's reference, a member's target, and, for an editor alone, the declaration of the local that a name reads or assigns (`NodeFacts.local_declarations`), and what each type name of a module names (`Shared.type_names`, `Shared.alias_names`).
  - The parser's and the checker's own names, such as `?2:3` of `x?.y` or the `to_string` of an interpolation, are not written in the source, so they are not found.
- **Completion** (`complete.lerta`) checks the program with the name under the cursor replaced by the checker's `COMPLETION_NAME`. Where the checker meets that name, as a name or as a member, it records in `ProgramWide.completion` the locals that the code there sees, or the type of the member's object, or the module or enum that the object names (`compiler/checker/completion_probe.lerta`). The items come from that.

