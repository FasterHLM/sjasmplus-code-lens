# Changelog

## 0.1.3
- Other extensions for `.asm` (DeZog, Z80 Macro-Assembler, Z80 Assembly) could take the assembler files, and the extension did nothing. Now it notices such a file and offers to associate the files with sjasmplus; "Check file associations" also reports these extensions.
- The extension also activates when an assembler file opens in one of these languages (e.g. a single file without a folder).
- Breakpoints can be set in sjasmplus files and listings (DeZog only enables them for its own list of languages).

## 0.1.2
- Telegram chat for questions and discussion: https://t.me/sjasmpluscodelens (README, Q & A link on the Marketplace).

## 0.1.1
- README: getting started, how to use each feature, all settings and commands, limitations.

## 0.1.0
- Forked from [ASM Code Lens](https://marketplace.visualstudio.com/items?itemName=maziac.asm-code-lens) 2.6.3 by maziac.
- Language ids are now `sjasmplus` and `sjasmplus-list`, settings and commands use the `sjasmplus-code-lens.` prefix.
- Listing files: `.lst` added. Sources: `.s` is no longer associated.
- Markdown code blocks: ```` ```sjasmplus ```` and ```` ```z80 ```` are recognized besides ```` ```asm ````, and ```` ```sjasmplus-list ```` besides ```` ```list ````.
- Removed the donation prompts and the "What's New" page.
- Syntax highlighting rewritten for sjasmplus 1.24: all directives (also with a leading dot) and their argument keywords, documented and undocumented Z80, Z80N and CSpect instructions, all number formats, labels by kind (local, `@`, `!`, temporary, SMC offsets), macros and struct instances, nested block comments, Lua blocks. Keywords of other assemblers (x86, RASM, Game Boy, ...) are gone. The listing grammar follows the real sjasmplus listing columns.
- Typing `af'` no longer inserts a second apostrophe.
- New symbol index instead of the regex search: sources are parsed and walked from the main files through `INCLUDE`s with the sjasmplus rules for modules, local, `@` and `!` labels, structs and struct instances, macro expansion, temporary labels and defines. All features (code lens, definition, references, rename, hover, completion, outline, workspace symbols, unreferenced labels) use it.
- Rename changes only the part of qualified names that belongs to the renamed symbol; modules can be renamed too.
- Folding for `DUP`/`REPT`, `WHILE`, `IF` and `LUA` blocks.
- New settings `includePaths` and `dirbol`; `labels.colon` and `labels.excludes` are removed (no longer needed).
- Features also work for files outside of a workspace folder.
- Formatting ("Format Document", "Format Selection") that adapts to the style of each file: instruction and directive columns, nested code, trailing comments per group of lines; options for keyword case, commas and operand spacing.
- Completions open when typing '.' (local labels, module members).
- Problems for labels that are not defined; IFDEF/IFNDEF blocks that are not assembled are evaluated and dimmed; new setting `defines` for command line defines.
- Semantic highlighting from the symbol index.
- Defines and labels created by Lua (`sj.insert_define`, `sj.insert_label`) are known.
- Offers to fix "files.associations" that send assembler files to another language (e.g. ASM Code Lens 2); commands "Check file associations" and "Associate assembler files with sjasmplus in this workspace".
- Faster re-indexing.
- Fixed: every settings change re-registered all providers, which could drop requests that were in flight.
