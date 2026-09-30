# sjasmplus Code Lens

A Visual Studio Code extension for Z80 assembly written for [sjasmplus](https://github.com/z00m128/sjasmplus), aimed mainly at ZX Spectrum development.

> **Status:** early development, not published yet.

## Features

- Syntax highlighting for sjasmplus sources and listing files, also in Markdown code blocks (` ```sjasmplus `, ` ```z80 `, ` ```asm `, ` ```sjasmplus-list `)
- Code lenses with the number of references above labels, constants, structs, struct fields, macros and defines
- Go to Definition, Find All References, Rename
- Outline view and breadcrumbs, "Go to Symbol in Workspace"
- Hover with the comments above a definition
- Completions of labels, local labels, macros and defines
- Code folding for labels, comment blocks, `MODULE`, `STRUCT`, `MACRO`, `DUP`/`REPT`, `IF` and `LUA` blocks
- "Find Labels with no Reference" (editor context menu) to spot dead code
- A hexadecimal calculator in the explorer and debug views

## sjasmplus aware

The extension builds a symbol index the way sjasmplus assembles the source: it starts at the main files (the files that no other file includes), follows `INCLUDE`s and gives every symbol its full sjasmplus name. So references are exact, not a text search:

- `MODULE` prefixes (also when the module is opened in the including file), `@global` labels, `!labels` that don't start a new local scope
- local labels `.loop` belong to the preceding label, `Main.loop` refers to them from elsewhere
- lookup like sjasmplus: first in the current module, then global
- `STRUCT` fields and the fields of struct instances (`pos POINT` defines `pos.x`, references to `pos.x` count for `POINT.x`)
- macros are expanded where they are used: labels inside a macro get the module and local scope of the call site
- temporary labels (`1`, `1_B`, `1_F`, and `1B`/`1F` in branches)
- `DEFINE`s, `IFDEF`, `IFUSED`, `EQU`, `DEFL`/`=`

Renaming changes only the part of a name that belongs to the symbol, e.g. renaming `clear` in module `util` turns `util.clear` into `util.cls` and `util.clear.fast` into `util.cls.fast`.

## Settings

All settings start with `sjasmplus-code-lens.`. The most important ones:

| Setting | Description |
|---|---|
| `includePaths` | Directories searched for `INCLUDE` files, like `-i`/`--inc` of sjasmplus. The workspace folder is always searched. |
| `dirbol` | Directives at the beginning of a line, like `--dirbol` of sjasmplus. |
| `excludeFiles` | Glob of files to leave out of the index, e.g. `**/{old,_archive}/**`. |
| `enableCodeLenses`, `enableHovering`, ... | Switch single features off. |

## Development

- `npm ci`, then press F5 in VS Code to start an Extension Development Host.
- `npm test` runs the unit tests of the parser and the symbol index.
- `npm run test:integration` runs the providers inside a downloaded VS Code on the project in `tests/integration/fixture`.

## Credits

Based on [ASM Code Lens](https://marketplace.visualstudio.com/items?itemName=maziac.asm-code-lens) 2.x by maziac, released under the MIT License.

## License

[MIT](LICENSE)
