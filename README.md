# sjasmplus Code Lens

A Visual Studio Code extension for Z80 assembly written for [sjasmplus](https://github.com/z00m128/sjasmplus), aimed mainly at ZX Spectrum development.

> **Status:** preview. Bug reports and ideas are welcome in the [issues](https://github.com/kolnogorov/sjasmplus-code-lens/issues).

## Features

- Syntax highlighting for sjasmplus sources and listing files, also in Markdown code blocks (` ```sjasmplus `, ` ```z80 `, ` ```asm `, ` ```sjasmplus-list `)
- Code lenses with the number of references above labels, constants, structs, struct fields, macros and defines
- Go to Definition, Find All References, Rename
- Outline view and breadcrumbs, "Go to Symbol in Workspace"
- Hover with the comments above a definition
- Completions of labels, local labels, macros and defines
- Code folding for labels, comment blocks, `MODULE`, `STRUCT`, `MACRO`, `DUP`/`REPT`, `IF` and `LUA` blocks
- Formatting ("Format Document", "Format Selection"), see below
- "Find Labels with no Reference" (editor context menu) to spot dead code
- Problems for labels that are not defined ("Label not found"), without the noise of macros, defines, blocks that are not assembled and files that no program includes
- `IFDEF`/`IFNDEF` blocks that are not assembled are dimmed
- Semantic highlighting: labels of code, data, constants, structs, fields, macros, defines and modules in their own colors
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

## Coming from ASM Code Lens

If your settings associate assembler files with the language ids of ASM Code Lens 2.x (or of another assembler extension), the files are not opened as sjasmplus. The extension notices this and offers to change the associations for the workspace or everywhere (also later with the command "sjasmplus: Check file associations"). By hand: associate the files with `sjasmplus` (and `sjasmplus-list` for listings), e.g.

```json
"files.associations": {
    "*.asm": "sjasmplus",
    "*.a80": "sjasmplus"
}
```

## Settings

All settings start with `sjasmplus-code-lens.`. The most important ones:

| Setting | Description |
|---|---|
| `includePaths` | Directories searched for `INCLUDE` files, like `-i`/`--inc` of sjasmplus. The workspace folder is always searched. |
| `dirbol` | Directives at the beginning of a line, like `--dirbol` of sjasmplus. |
| `defines` | Defines set on the command line (`-D`), so the extension knows which `IFDEF` blocks are assembled. |
| `diagnostics.unresolvedLabels` | Severity of "Label not found" problems, or `off`. |
| `dimInactiveBlocks` | Dim `IFDEF`/`IFNDEF` blocks that are not assembled. |
| `excludeFiles` | Glob of files to leave out of the index, e.g. `**/{old,_archive}/**`. Worth setting for folders with sources of other assemblers: they are indexed too and slow down large workspaces. |
| `enableCodeLenses`, `enableHovering`, ... | Switch single features off. |

## Formatting

The formatter adapts to the style of each file instead of imposing one. It only changes whitespace (and the case of keywords, if you want): labels stay at the beginning of the line, the code itself is never changed. Tabs or spaces and the tab size come from the editor settings (`editor.insertSpaces`, `editor.tabSize`). Format on save works with the usual `editor.formatOnSave`.

| Setting (`sjasmplus-code-lens.format.`) | Default | |
|---|---|---|
| `indentation` | `align` | `align`: statements go to the instruction column. Lines indented deeper are nested code and keep their offset; directives written left of the instructions (`MODULE`, `IFDEF`, ...) go to the directive column. `keep`: indentation is not changed. |
| `instructionColumn` | `0` | 0 = the most frequent column of the file, or a column counted from 0 (24 = three tabs of 8). |
| `directiveColumn` | `0` | 0 = the most frequent column of the outdented directives of the file, or a column. |
| `case` | `keep` | `lower` / `upper` for instructions, directives, registers, conditions and operator words. Labels, macros and strings are never changed. |
| `commaSpace` | `keep` | `none` (`ld a,b`) / `space` (`ld a, b`). The double comma `,,` stays together. |
| `operandSpacing` | `keep` | `space` / `tab` between the instruction and its operands. |
| `trailingComments` | `align` | `align` comments after code within each group of consecutive lines (or to `commentColumn`), `keep`. |
| `commentColumn` | `0` | 0 = per group of lines, or a column. |

Lines inside block comments and Lua, multi-line struct initializers and lines with `/* */` are left as they are.

## Development

- `npm ci`, then start "Launch Extension: open a project" in the Run and Debug view (F5). It asks for a sjasmplus project folder and opens it in an Extension Development Host window with this extension loaded.
- `npm test` runs the unit tests of the parser and the symbol index.
- `npm run test:integration` runs the providers inside a downloaded VS Code on the project in `tests/integration/fixture`.
- `npm run package` builds the `.vsix` (install it with "Extensions: Install from VSIX..."), `npm run publish` publishes it to the Marketplace.

## Credits

Based on [ASM Code Lens](https://marketplace.visualstudio.com/items?itemName=maziac.asm-code-lens) 2.x by maziac, released under the MIT License.

## License

[MIT](LICENSE)
