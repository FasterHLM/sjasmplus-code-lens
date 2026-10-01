/**
 * The symbol index of a sjasmplus project.
 *
 * All files are parsed, then every root file (a file that no other file
 * includes) is walked in assembly order, following INCLUDEs, the way
 * sjasmplus processes the source. During the walk the full names of all
 * definitions are built with the sjasmplus rules (modules, local labels,
 * '@' and '!' labels, structs, macro expansion, temporary labels) and
 * every reference is recorded with its lookup context. Afterwards the
 * references are resolved against the definitions.
 */
import * as path from 'path';
import {Token, TokenKind} from './lexer';
import {getFileOperand, LabelField, ParsedLine, ParsedText, parseText, Statement} from './parser';
import {BRANCHES, CONDITIONS, DATA_DIRECTIVES, DEFL_DIRECTIVES, DIRECTIVES, EQU_DIRECTIVES, MNEMONICS, NON_EXPRESSION_DIRECTIVES, PREDEFINED, REGISTERS, WORD_OPERATORS} from './keywords';


export type SymbolKind = 'label' | 'data' | 'equ' | 'defl' | 'struct' | 'field' | 'macro' | 'module' | 'define' | 'temp' | 'macrolocal';


/** A definition of a symbol. */
export interface SymbolDef {
	/** Name space prefix + name, e.g. "L:main.Main.loop", "X:mymacro", "D:DEBUG". */
	key: string;
	/** The full name, e.g. "main.Main.loop". */
	name: string;
	kind: SymbolKind;
	/** As written in the source, e.g. ".loop". */
	written: string;
	file: string;
	line: number;
	start: number;
	end: number;
	/** The module path at the definition, e.g. "main.vdp". */
	module: string;
	/** For struct instance fields: the key of the struct field it is derived from. */
	derivedFrom?: string;
	/** Synthetic definitions (struct instance fields) have no own text in the source. */
	synthetic?: boolean;
	/** Index of the root file walk that produced this definition. */
	root: number;
}


/** A reference to a symbol. */
export interface SymbolRef {
	/** The resolved key (undefined if not resolved). */
	key?: string;
	written: string;
	file: string;
	line: number;
	start: number;
	end: number;
	root: number;
}


/** A definition or reference at a text position. */
export interface Occurrence {
	file: string;
	line: number;
	start: number;
	end: number;
	written: string;
	/** The symbol key, undefined for unresolved references. */
	key?: string;
	isDef: boolean;
}


/** An INCLUDE statement and the file it resolves to. */
export interface IncludeLink {
	line: number;
	start: number;
	end: number;
	/** The resolved file (undefined if not found). */
	target?: string;
}


/** Module and local label prefix valid from a line on (used for completions). */
export interface ScopePoint {
	line: number;
	module: string;
	localPrefix: string;
}


export interface ProjectOptions {
	/** Directories searched for INCLUDE files (absolute paths). */
	includePaths?: string[];
	/** Reads a file that is not part of the project (e.g. an include outside the workspace). */
	readFile?: (filePath: string) => string | undefined;
	/** Like sjasmplus --dirbol. */
	dirbol?: boolean;
}


interface FileEntry {
	path: string;
	text: string;
	listing: boolean;
	parsed?: ParsedText;
	/** False for files loaded only because they are included. */
	member: boolean;
}


/** One field of a struct, relative to the struct (e.g. "C.RED"). */
interface StructField {
	suffix: string;
	/** The key of the field definition (or of the field of a nested struct). */
	origin: string;
}


interface MacroInfo {
	def: SymbolDef;
	params: Set<string>;
	file: string;
	/** Lines of the body (first line after MACRO up to the line before ENDM). */
	firstLine: number;
	lastLine: number;
	/** Label and statements on the ENDM line before ENDM. */
	endLine?: number;
}


interface LastLabel {
	name: string;
	global: boolean;
}


interface WalkState {
	root: number;
	modules: string[];
	lastLabel: LastLabel;
	struct?: {def: SymbolDef, fields: StructField[]};
	/** Names substituted textually: DEFINEs and DUP index variables. */
	defines: Set<string>;
	/** Set while replaying a macro body. */
	macro?: {info: MacroInfo, params: Set<string>};
	includeStack: string[];
	macroDepth: number;
}


interface PendingRef {
	ref: SymbolRef;
	candidates: string[];
}


interface TempDef {
	num: string;
	seq: number;
	key: string;
	root: number;
}


interface TempRef {
	ref: SymbolRef;
	num: string;
	forward: boolean;
	seq: number;
}


const fileKeys = new Map<string, string>();

/** Normalized map key for a file path (cached, it is used for every definition and reference). */
export function fileKey(filePath: string): string {
	let key = fileKeys.get(filePath);
	if (key === undefined) {
		const p = path.resolve(filePath);
		key = process.platform === 'win32' ? p.toLowerCase() : p;
		fileKeys.set(filePath, key);
	}
	return key;
}


const CONDITIONAL_OPS = new Set(['jp', 'jr', 'call', 'ret']);
const FILE_FIRST_OPERAND = new Set(['incbin', 'binary', 'insert', 'inchob', 'inctrd', 'savebin', 'savedev', 'savehob', 'savesna', 'savetap', 'savetrd', 'save3dos', 'saveamsdos', 'savecdt', 'savecpcsna', 'savecpr', 'savehex', 'shellexec', 'emptytrd', 'emptytap']);
const MAX_INCLUDE_DEPTH = 20;
const MAX_MACRO_DEPTH = 20;


export class Project {
	protected options: ProjectOptions;
	protected files = new Map<string, FileEntry>();
	protected dirty = true;

	// Results of the analysis
	protected defsByKey = new Map<string, SymbolDef[]>();
	protected refsByKey = new Map<string, SymbolRef[]>();
	protected occurrences = new Map<string, Occurrence[]>();
	protected defsByFile = new Map<string, SymbolDef[]>();
	protected includes = new Map<string, IncludeLink[]>();
	protected scopes = new Map<string, ScopePoint[]>();
	protected derived = new Map<string, Set<string>>();
	protected rootKeys: Set<string>[] = [];
	protected unresolved: SymbolRef[] = [];

	// Walk state shared by all roots
	protected pending: PendingRef[] = [];
	protected tempDefs: TempDef[] = [];
	protected tempRefs: TempRef[] = [];
	protected tempSeq = 0;
	protected structs = new Map<string, StructField[]>();
	protected macros = new Map<string, MacroInfo>();
	protected invokedMacros = new Set<string>();
	protected seen = new Set<string>();
	protected scopedFiles = new Set<string>();


	constructor(options: ProjectOptions = {}) {
		this.options = options;
	}


	/** Sets options (include paths, dirbol). Marks the project dirty. */
	public setOptions(options: ProjectOptions) {
		this.options = options;
		for (const entry of this.files.values())
			entry.parsed = undefined;
		this.dirty = true;
	}


	/** Adds or updates a file of the project. */
	public setFile(filePath: string, text: string, listing = false) {
		const key = fileKey(filePath);
		const entry = this.files.get(key);
		if (entry?.member && entry.text === text && entry.listing === listing)
			return;
		this.files.set(key, {path: filePath, text, listing, member: true});
		this.dirty = true;
	}


	/** Removes a file from the project. */
	public removeFile(filePath: string) {
		if (this.files.delete(fileKey(filePath)))
			this.dirty = true;
	}


	/** Forgets a file that was loaded from disk because it was included. */
	public invalidateExternal(filePath: string) {
		const key = fileKey(filePath);
		const entry = this.files.get(key);
		if (entry && !entry.member) {
			this.files.delete(key);
			this.dirty = true;
		}
	}


	public hasFile(filePath: string): boolean {
		return this.files.get(fileKey(filePath))?.member ?? false;
	}


	/** Returns the paths of all project files. */
	public getFilePaths(): string[] {
		return [...this.files.values()].filter(e => e.member).map(e => e.path);
	}


	/** Returns the text lines of a file known to the project. */
	public getLines(filePath: string): string[] | undefined {
		const entry = this.files.get(fileKey(filePath));
		if (!entry)
			return undefined;
		return this.getParsed(entry).lines;
	}


	/** Re-analyzes the project if something changed. */
	public update() {
		if (!this.dirty)
			return;
		this.analyze();
		this.dirty = false;
	}


	// ---- Queries -----------------------------------------------------------

	/** All definitions and references at the position. */
	public occurrencesAt(filePath: string, line: number, character: number): Occurrence[] {
		this.update();
		const list = this.occurrences.get(fileKey(filePath)) ?? [];
		return list.filter(o => o.line === line && o.start <= character && character <= o.end);
	}


	/** All occurrences in a file. */
	public occurrencesInFile(filePath: string): Occurrence[] {
		this.update();
		return this.occurrences.get(fileKey(filePath)) ?? [];
	}


	/** All occurrences of all files (including files outside the project that are included). */
	public getAllOccurrences(): Occurrence[] {
		this.update();
		const all: Occurrence[] = [];
		for (const list of this.occurrences.values())
			all.push(...list);
		return all;
	}


	/** The definitions of a symbol (unique locations). */
	public getDefinitions(key: string): SymbolDef[] {
		this.update();
		return uniqueByLocation(this.defsByKey.get(key) ?? []);
	}


	/**
	 * The references of a symbol (unique locations).
	 * For struct fields the references to the fields of all struct instances are included.
	 */
	public getReferences(key: string): SymbolRef[] {
		this.update();
		const refs = [...(this.refsByKey.get(key) ?? [])];
		for (const d of this.derived.get(key) ?? [])
			refs.push(...(this.refsByKey.get(d) ?? []));
		return uniqueByLocation(refs);
	}


	/** Keys of the instance fields derived from a struct field. */
	public getDerivedKeys(key: string): string[] {
		this.update();
		return [...(this.derived.get(key) ?? [])];
	}


	/** The definitions located in a file (unique, without synthetic ones). */
	public getDefinitionsInFile(filePath: string): SymbolDef[] {
		this.update();
		return uniqueByLocation(this.defsByFile.get(fileKey(filePath)) ?? []);
	}


	/** All definitions (unique, without synthetic ones). */
	public getAllDefinitions(): SymbolDef[] {
		this.update();
		const all: SymbolDef[] = [];
		for (const defs of this.defsByFile.values())
			all.push(...defs);
		return uniqueByLocation(all);
	}


	/** References that could not be resolved. */
	public getUnresolved(): SymbolRef[] {
		this.update();
		return uniqueByLocation(this.unresolved);
	}


	/** The INCLUDE statement at the position. */
	public includeAt(filePath: string, line: number, character: number): IncludeLink | undefined {
		this.update();
		return (this.includes.get(fileKey(filePath)) ?? []).find(l => l.line === line && l.start <= character && character <= l.end);
	}


	/** Module and local label prefix at a line. */
	public scopeAt(filePath: string, line: number): ScopePoint {
		this.update();
		const points = this.scopes.get(fileKey(filePath)) ?? [];
		let result: ScopePoint = {line: 0, module: '', localPrefix: '_'};
		for (const p of points) {
			if (p.line > line)
				break;
			result = p;
		}
		return result;
	}


	// ---- Analysis ----------------------------------------------------------

	protected getParsed(entry: FileEntry): ParsedText {
		entry.parsed ??= parseText(entry.text, {listing: entry.listing, dirbol: this.options.dirbol});
		return entry.parsed;
	}


	protected analyze() {
		this.defsByKey.clear();
		this.refsByKey.clear();
		this.occurrences.clear();
		this.defsByFile.clear();
		this.includes.clear();
		this.scopes.clear();
		this.derived.clear();
		this.rootKeys = [];
		this.unresolved = [];
		this.pending = [];
		this.tempDefs = [];
		this.tempRefs = [];
		this.tempSeq = 0;
		this.structs.clear();
		this.macros.clear();
		this.invokedMacros.clear();
		this.seen.clear();
		this.scopedFiles.clear();
		this.seenOccurrence.clear();

		// Find the roots: member files not included by other member files
		const included = new Set<string>();
		const members = [...this.files.entries()].filter(([, e]) => e.member);
		for (const [key, entry] of members) {
			if (entry.listing)
				continue;
			const parsed = this.getParsed(entry);
			parsed.parsed.forEach((pl, i) => {
				for (const st of pl.statements) {
					if (st.opLower !== 'include')
						continue;
					const op = getFileOperand(parsed.lines[i], st);
					const target = op && this.resolveInclude(entry.path, op.path, op.angle);
					if (target && target !== key)
						included.add(target);
				}
			});
		}

		const roots = members.filter(([key]) => !included.has(key)).map(([key]) => key);
		let rootIndex = 0;
		for (const key of roots)
			this.walkRoot(key, rootIndex++);
		// Files not reached from any root (e.g. include cycles)
		for (const [key] of members) {
			if (!this.seen.has(key))
				this.walkRoot(key, rootIndex++);
		}

		// Macros that were never invoked: index their body once in the definition context
		for (const info of this.macros.values()) {
			if (!this.invokedMacros.has(info.def.key)) {
				const state = this.newState(info.def.root);
				state.modules = info.def.module ? [info.def.module] : [];
				this.replayMacro(info, state);
			}
		}

		this.resolvePending();
		this.resolveTemps();
	}


	protected newState(root: number): WalkState {
		return {
			root,
			modules: [],
			lastLabel: {name: '_', global: false},
			defines: new Set(),
			includeStack: [],
			macroDepth: 0
		};
	}


	protected walkRoot(key: string, root: number) {
		this.rootKeys[root] = new Set();
		const state = this.newState(root);
		this.walkFile(key, state);
	}


	protected walkFile(key: string, state: WalkState) {
		const entry = this.files.get(key);
		if (!entry)
			return;
		if (state.includeStack.includes(key) || state.includeStack.length >= MAX_INCLUDE_DEPTH)
			return;
		this.seen.add(key);
		state.includeStack.push(key);
		const parsed = this.getParsed(entry);
		const recordScopes = !this.scopedFiles.has(key);
		this.scopedFiles.add(key);
		if (recordScopes)
			this.scopes.set(key, []);

		const len = parsed.parsed.length;
		for (let i = 0; i < len; i++) {
			const pl = parsed.parsed[i];
			if (pl.lua)
				continue;
			// MACRO definition: skip the body, it is replayed on invocation
			const macroInfo = this.checkMacroDefinition(entry, parsed, i, state);
			if (macroInfo) {
				i = macroInfo.endLine ?? macroInfo.lastLine;
				continue;
			}
			this.processLine(entry, parsed.lines[i], pl, i, state);
			if (recordScopes)
				this.recordScope(key, i, state);
		}
		state.includeStack.pop();
	}


	protected recordScope(key: string, line: number, state: WalkState) {
		const points = this.scopes.get(key)!;
		const module = state.modules.join('.');
		const localPrefix = this.localPrefix(state);
		const last = points[points.length - 1];
		if (last?.module === module && last.localPrefix === localPrefix)
			return;
		// The scope is valid after the line, i.e. from the next line on
		points.push({line: line + 1, module, localPrefix});
	}


	/**
	 * Checks for a MACRO definition at line 'i'. If found, the macro is
	 * registered and its info (with the body range) returned.
	 */
	protected checkMacroDefinition(entry: FileEntry, parsed: ParsedText, i: number, state: WalkState): MacroInfo | undefined {
		if (state.macro)
			return undefined;
		const pl = parsed.parsed[i];
		const stIndex = pl.statements.findIndex(s => s.opLower === 'macro' && !s.inhibit);
		if (stIndex < 0)
			return undefined;
		const st = pl.statements[stIndex];
		let nameToken: {text: string, start: number, end: number} | undefined;
		let params = st.operands;
		if (pl.label && stIndex === 0) {
			nameToken = pl.label;
		}
		else if (st.operands.length > 0 && st.operands[0].kind === TokenKind.Ident) {
			nameToken = st.operands[0];
			params = st.operands.slice(1);
		}
		// Find ENDM
		let endLine: number | undefined;
		for (let j = i + 1; j < parsed.parsed.length; j++) {
			if (parsed.parsed[j].statements.some(s => s.opLower === 'endm')) {
				endLine = j;
				break;
			}
		}
		const lastLine = (endLine ?? parsed.parsed.length) - 1;

		if (!nameToken)
			return {def: undefined as any, params: new Set(), file: entry.path, firstLine: i + 1, lastLine, endLine};
		const name = nameToken.text;
		const def = this.addDef(state, {
			key: 'X:' + name, name, kind: 'macro', written: name,
			file: entry.path, line: i, start: nameToken.start, end: nameToken.end
		});
		const paramNames = new Set<string>();
		for (const t of params)
			if (t.kind === TokenKind.Ident)
				paramNames.add(t.text);
		const info: MacroInfo = {def, params: paramNames, file: entry.path, firstLine: i + 1, lastLine, endLine};
		this.macros.set(name, info);
		return info;
	}


	/** Replays a macro body with the state of the invocation. */
	protected replayMacro(info: MacroInfo, state: WalkState) {
		if (!info.def || state.macroDepth >= MAX_MACRO_DEPTH)
			return;
		const entry = this.files.get(fileKey(info.file));
		if (!entry)
			return;
		const parsed = this.getParsed(entry);
		const outerMacro = state.macro;
		state.macro = {info, params: info.params};
		state.macroDepth++;
		const last = info.endLine ?? info.lastLine;
		for (let i = info.firstLine; i <= last && i < parsed.parsed.length; i++) {
			const pl = parsed.parsed[i];
			if (pl.lua)
				continue;
			if (i === info.endLine) {
				// Only the part before ENDM belongs to the body
				const endIndex = pl.statements.findIndex(s => s.opLower === 'endm');
				this.processLine(entry, parsed.lines[i], {...pl, statements: pl.statements.slice(0, endIndex)}, i, state);
			}
			else
				this.processLine(entry, parsed.lines[i], pl, i, state);
		}
		state.macroDepth--;
		state.macro = outerMacro;
	}


	protected moduleName(state: WalkState): string {
		return state.modules.join('.');
	}


	protected withModule(state: WalkState, name: string): string {
		const module = this.moduleName(state);
		return module ? module + '.' + name : name;
	}


	/** The prefix for local labels, e.g. "main.Main". */
	protected localPrefix(state: WalkState): string {
		return state.lastLabel.global ? state.lastLabel.name : this.withModule(state, state.lastLabel.name);
	}


	protected processLine(entry: FileEntry, lineText: string, pl: ParsedLine, line: number, state: WalkState) {
		const first = pl.statements[0];
		if (pl.label)
			this.processLabel(entry, pl.label, first, line, state);
		pl.statements.forEach((st, index) => this.processStatement(entry, lineText, st, index === 0 ? pl.label : undefined, line, state));
	}


	/** Defines the label at the beginning of a line. */
	protected processLabel(entry: FileEntry, label: LabelField, first: Statement | undefined, line: number, state: WalkState) {
		const op = first?.opLower ?? '';
		let written = label.text;
		const loc = {file: entry.path, line, start: label.start, end: label.end};

		// Temporary label (a replayed macro body reuses the key of the first expansion)
		if (/^\d+$/.test(written)) {
			const def = this.addDef(state, {key: `T:${state.root}:${this.tempSeq}`, name: written, kind: 'temp', written, ...loc});
			this.tempDefs.push({num: written, seq: this.tempSeq++, key: def.key, root: state.root});
			return;
		}

		// Inside a macro: ".x" is local to each expansion
		if (state.macro && written.startsWith('.')) {
			const name = state.macro.info.def.name + '>' + written;
			this.addDef(state, {key: 'ML:' + name, name, kind: 'macrolocal', written, ...loc});
			return;
		}

		// Struct field
		if (state.struct) {
			const bare = written.replace(/^[@.!]+/, '');
			const name = state.struct.def.name + '.' + bare;
			const fieldDef = this.addDef(state, {key: 'L:' + name, name, kind: 'field', written, ...loc});
			state.struct.fields.push({suffix: bare, origin: fieldDef.key});
			// Nested struct: add its fields
			if (first?.op && first.op.kind === TokenKind.Ident && !DIRECTIVES.has(op)) {
				const nested = this.findStruct(first.opText, state);
				if (nested) {
					for (const f of nested.fields) {
						const subName = name + '.' + f.suffix;
						this.addDef(state, {key: 'L:' + subName, name: subName, kind: 'field', written, ...loc, derivedFrom: f.origin, synthetic: true});
						state.struct.fields.push({suffix: bare + '.' + f.suffix, origin: f.origin});
					}
				}
			}
			return;
		}

		let kind: SymbolKind = 'label';
		if (EQU_DIRECTIVES.has(op))
			kind = 'equ';
		else if (DEFL_DIRECTIVES.has(op))
			kind = 'defl';
		else if (DATA_DIRECTIVES.has(op))
			kind = 'data';

		let name: string;
		let setsLast: LastLabel | undefined;
		if (written.startsWith('@.')) {
			// Regular local label (relative to the label before the macro invocation)
			name = this.localPrefix(state) + written.substring(1);
		}
		else if (written.startsWith('@')) {
			name = written.substring(1);
			setsLast = {name, global: true};
		}
		else if (written.startsWith('.')) {
			name = this.localPrefix(state) + written;
		}
		else if (written.startsWith('!')) {
			written = written.substring(1);
			name = this.withModule(state, written);
		}
		else {
			name = this.withModule(state, written);
			setsLast = {name: written, global: false};
		}

		const def = this.addDef(state, {key: 'L:' + name, name, kind, written: label.text, ...loc});
		if (setsLast)
			state.lastLabel = setsLast;

		// Struct instance: define the fields
		if (first?.op && first.op.kind === TokenKind.Ident && !first.inhibit && !MNEMONICS.has(op) && !DIRECTIVES.has(op) && !this.macros.has(first.opText)) {
			const struct = this.findStruct(first.opText, state);
			if (struct) {
				for (const f of struct.fields) {
					const fieldName = name + '.' + f.suffix;
					this.addDef(state, {key: 'L:' + fieldName, name: fieldName, kind: 'field', written: label.text, ...loc, derivedFrom: f.origin, synthetic: true});
				}
				def.kind = 'data';
			}
		}
	}


	/** Finds a struct by name with the label lookup rules. */
	protected findStruct(written: string, state: WalkState): {key: string, fields: StructField[]} | undefined {
		for (const candidate of this.labelCandidates(written, state)) {
			const fields = this.structs.get(candidate);
			if (fields)
				return {key: candidate, fields};
		}
		return undefined;
	}


	protected processStatement(entry: FileEntry, lineText: string, st: Statement, label: LabelField | undefined, line: number, state: WalkState) {
		const op = st.opLower;
		const operands = st.operands;
		const file = entry.path;

		if (!st.op)
			return;

		// Macro invocation
		if (st.op.kind === TokenKind.Ident && !st.inhibit) {
			const macro = this.macros.get(st.opText);
			if (macro?.def) {
				this.addResolvedRef(state, 'X:' + st.opText, st.opText, file, line, st.op.start, st.op.end);
				this.invokedMacros.add(macro.def.key);
				this.collectRefs(operands, state, file, line, false, false);
				// A listing contains the expanded lines already
				if (!entry.listing)
					this.replayMacro(macro, state);
				return;
			}
		}

		switch (op) {
			case 'module': {
				const nameToken = operands[0];
				if (nameToken?.kind === TokenKind.Ident) {
					state.modules.push(...nameToken.text.split('.'));
					const name = this.moduleName(state);
					this.addDef(state, {key: 'M:' + name, name, kind: 'module', written: nameToken.text, file, line, start: nameToken.start, end: nameToken.end});
				}
				state.lastLabel = {name: '_', global: false};
				return;
			}
			case 'endmodule':
			case 'endmod':
				state.modules.pop();
				state.lastLabel = {name: '_', global: false};
				return;
			case 'struct': {
				const nameToken = operands[0];
				if (nameToken?.kind === TokenKind.Ident) {
					let written = nameToken.text;
					let name: string;
					if (written.startsWith('@')) {
						written = written.substring(1);
						name = written;
						state.lastLabel = {name, global: true};
					}
					else {
						name = this.withModule(state, written);
						state.lastLabel = {name: written, global: false};
					}
					const def = this.addDef(state, {key: 'L:' + name, name, kind: 'struct', written: nameToken.text, file, line, start: nameToken.start, end: nameToken.end});
					state.struct = {def, fields: []};
					this.collectRefs(operands.slice(1), state, file, line, false, false);
				}
				return;
			}
			case 'ends':
				if (state.struct) {
					this.structs.set(state.struct.def.key, state.struct.fields);
					state.struct = undefined;
				}
				return;
			case 'define':
			case 'define+':
			case 'defarray':
			case 'defarray+': {
				const nameToken = operands[0];
				if (nameToken?.kind === TokenKind.Ident) {
					const name = nameToken.text;
					if (op.endsWith('+') && state.defines.has(name))
						this.addResolvedRef(state, 'D:' + name, name, file, line, nameToken.start, nameToken.end);
					else
						this.addDef(state, {key: 'D:' + name, name, kind: 'define', written: name, file, line, start: nameToken.start, end: nameToken.end});
					state.defines.add(name);
				}
				this.collectRefs(operands.slice(1), state, file, line, false, false);
				return;
			}
			case 'undefine': {
				const nameToken = operands[0];
				if (nameToken?.kind === TokenKind.Ident) {
					this.addPendingDefineRef(state, nameToken, file, line);
					state.defines.delete(nameToken.text);
				}
				return;
			}
			case 'ifdef':
			case 'ifndef': {
				const nameToken = operands[0];
				if (nameToken?.kind === TokenKind.Ident)
					this.addPendingDefineRef(state, nameToken, file, line);
				return;
			}
			case 'include': {
				const operand = getFileOperand(lineText, st);
				// A listing contains the included lines already
				if (!operand || entry.listing)
					return;
				const target = this.resolveInclude(entry.path, operand.path, operand.angle);
				this.addInclude(fileKey(entry.path), {line, start: operand.start, end: operand.end, target: target && this.files.get(target)?.path});
				if (target && !state.macro)
					this.walkFile(target, state);
				return;
			}
			case 'dup':
			case 'rept': {
				// DUP count[, index variable]
				const comma = operands.findIndex(t => t.text === ',');
				if (comma >= 0) {
					const indexVar = operands[comma + 1];
					if (indexVar?.kind === TokenKind.Ident)
						state.defines.add(indexVar.text);
					this.collectRefs(operands.slice(0, comma), state, file, line, false, false);
				}
				else
					this.collectRefs(operands, state, file, line, false, false);
				return;
			}
			case 'lua':
			case 'endlua':
			case 'macro':
			case 'endm':
				return;
		}

		if (NON_EXPRESSION_DIRECTIVES.has(op))
			return;

		// First operand is a file name
		let exprOperands = operands;
		if (FILE_FIRST_OPERAND.has(op) && operands[0]?.kind !== TokenKind.String) {
			const fileOp = getFileOperand(lineText, st);
			exprOperands = fileOp ? operands.filter(t => t.start >= fileOp.end) : operands;
		}

		// Unknown operator: struct instance or reference to an unknown macro/label
		if (st.op.kind === TokenKind.Ident && !MNEMONICS.has(op) && !DIRECTIVES.has(op)) {
			const struct = this.findStruct(st.opText, state);
			if (struct)
				this.addResolvedRef(state, struct.key, st.opText, file, line, st.op.start, st.op.end);
			else
				this.addLabelRef(state, st.op, file, line);
		}

		const isBranch = BRANCHES.has(op);
		const hasCondition = CONDITIONAL_OPS.has(op);
		this.collectRefs(exprOperands, state, file, line, isBranch, hasCondition);
	}


	/**
	 * Records references for all identifiers in the tokens.
	 * @param isBranch Allows the old temporary label syntax "1B"/"1F".
	 * @param hasCondition Operands may be conditions (jp z,...), also in
	 * multi-argument form (call x, z,y).
	 */
	protected collectRefs(tokens: Token[], state: WalkState, file: string, line: number, isBranch: boolean, hasCondition: boolean) {
		for (const t of tokens) {
			if (t.kind === TokenKind.Number) {
				const m = /^(\d+)_([bBfF])$/.exec(t.text) ?? (isBranch ? /^(\d+)([bBfF])$/.exec(t.text) : null);
				if (m)
					this.addTempRef(state, t, m[1], m[2].toLowerCase() === 'f', file, line);
				continue;
			}
			if (t.kind !== TokenKind.Ident)
				continue;
			const lower = t.text.toLowerCase();
			if (REGISTERS.has(lower) || WORD_OPERATORS.has(lower) || PREDEFINED.has(t.text))
				continue;
			if (hasCondition && CONDITIONS.has(lower))
				continue;
			if (state.macro?.params.has(t.text))
				continue;
			if (state.defines.has(t.text)) {
				this.addResolvedRef(state, 'D:' + t.text, t.text, file, line, t.start, t.end);
				continue;
			}
			this.addLabelRef(state, t, file, line);
		}
	}


	/** The lookup order of a label reference (keys). */
	protected labelCandidates(written: string, state: WalkState): string[] {
		if (written.startsWith('@'))
			return ['L:' + written.substring(1)];
		if (written.startsWith('.'))
			return ['L:' + this.localPrefix(state) + written];
		const module = this.moduleName(state);
		if (module)
			return ['L:' + module + '.' + written, 'L:' + written];
		return ['L:' + written];
	}


	protected addLabelRef(state: WalkState, t: Token, file: string, line: number) {
		const ref: SymbolRef = {written: t.text, file, line, start: t.start, end: t.end, root: state.root};
		let candidates = this.labelCandidates(t.text, state);
		if (state.macro && t.text.startsWith('.'))
			candidates = ['ML:' + state.macro.info.def.name + '>' + t.text, ...candidates];
		this.pending.push({ref, candidates});
	}


	protected addPendingDefineRef(state: WalkState, t: Token, file: string, line: number) {
		const ref: SymbolRef = {written: t.text, file, line, start: t.start, end: t.end, root: state.root};
		this.pending.push({ref, candidates: ['D:' + t.text]});
	}


	protected addTempRef(state: WalkState, t: Token, num: string, forward: boolean, file: string, line: number) {
		const ref: SymbolRef = {written: t.text, file, line, start: t.start, end: t.end, root: state.root};
		this.tempRefs.push({ref, num, forward, seq: this.tempSeq});
	}


	protected addResolvedRef(state: WalkState, key: string, written: string, file: string, line: number, start: number, end: number) {
		this.storeRef({key, written, file, line, start, end, root: state.root});
	}


	protected storeRef(ref: SymbolRef) {
		if (!this.markSeen(fileKey(ref.file), ref.line, ref.start, ref.key ?? ''))
			return;
		if (ref.key) {
			let list = this.refsByKey.get(ref.key);
			if (!list)
				this.refsByKey.set(ref.key, list = []);
			list.push(ref);
		}
		else
			this.unresolved.push(ref);
		this.addOccurrence({file: ref.file, line: ref.line, start: ref.start, end: ref.end, written: ref.written, key: ref.key, isDef: false});
	}

	/** Occurrences already stored, per file and position (a file included twice or a replayed macro is walked again). */
	protected seenOccurrence = new Map<string, Map<number, Set<string>>>();

	/** Returns true (and remembers it) if the occurrence is new. */
	protected markSeen(fk: string, line: number, start: number, tag: string): boolean {
		let byPos = this.seenOccurrence.get(fk);
		if (!byPos)
			this.seenOccurrence.set(fk, byPos = new Map());
		const pos = line * 65536 + start;
		let tags = byPos.get(pos);
		if (!tags)
			byPos.set(pos, tags = new Set());
		if (tags.has(tag))
			return false;
		tags.add(tag);
		return true;
	}


	protected addDef(state: WalkState, d: Omit<SymbolDef, 'module' | 'root'> & {module?: string}): SymbolDef {
		const def: SymbolDef = {module: this.moduleName(state), root: state.root, ...d};
		let list = this.defsByKey.get(def.key);
		if (!list)
			this.defsByKey.set(def.key, list = []);
		// Same definition reached again (e.g. file included twice, macro replayed)
		const existing = list.find(e => e.line === def.line && e.start === def.start && fileKey(e.file) === fileKey(def.file) && e.root === def.root);
		if (existing)
			return existing;
		list.push(def);
		this.rootKeys[state.root]?.add(def.key);
		if (def.derivedFrom) {
			let set = this.derived.get(def.derivedFrom);
			if (!set)
				this.derived.set(def.derivedFrom, set = new Set());
			set.add(def.key);
		}
		if (!def.synthetic) {
			const fk = fileKey(def.file);
			let fileDefs = this.defsByFile.get(fk);
			if (!fileDefs)
				this.defsByFile.set(fk, fileDefs = []);
			fileDefs.push(def);
			if (this.markSeen(fk, def.line, def.start, 'def ' + def.key))
				this.addOccurrence({file: def.file, line: def.line, start: def.start, end: def.end, written: def.written, key: def.key, isDef: true});
		}
		return def;
	}


	protected addOccurrence(o: Occurrence) {
		const fk = fileKey(o.file);
		let list = this.occurrences.get(fk);
		if (!list)
			this.occurrences.set(fk, list = []);
		list.push(o);
	}


	protected addInclude(fk: string, link: IncludeLink) {
		let list = this.includes.get(fk);
		if (!list)
			this.includes.set(fk, list = []);
		if (!list.some(l => l.line === link.line && l.start === link.start))
			list.push(link);
	}


	/** Resolves an INCLUDE file name to a file key (loads files from outside the project if needed). */
	protected resolveInclude(fromFile: string, includePath: string, angle: boolean): string | undefined {
		const dirs = [path.dirname(fromFile)];
		const incPaths = this.options.includePaths ?? [];
		if (angle)
			dirs.unshift(...incPaths);
		else
			dirs.push(...incPaths);
		for (const dir of dirs) {
			const full = path.resolve(dir, includePath);
			const key = fileKey(full);
			if (this.files.has(key))
				return key;
			const text = this.options.readFile?.(full);
			if (text !== undefined) {
				this.files.set(key, {path: full, text, listing: false, member: false});
				return key;
			}
		}
		return undefined;
	}


	protected resolvePending() {
		for (const {ref, candidates} of this.pending) {
			// Prefer definitions of the same root, then any
			const rootKeys = this.rootKeys[ref.root];
			let key = candidates.find(c => rootKeys?.has(c));
			key ??= candidates.find(c => this.defsByKey.has(c));
			ref.key = key;
			this.storeRef(ref);
		}
		this.pending = [];
	}


	protected resolveTemps() {
		// Temporary labels are resolved in assembly order (tempDefs are sorted by seq)
		const byNum = new Map<string, TempDef[]>();
		for (const d of this.tempDefs) {
			let list = byNum.get(d.num);
			if (!list)
				byNum.set(d.num, list = []);
			list.push(d);
		}
		for (const t of this.tempRefs) {
			const list = (byNum.get(t.num) ?? []).filter(d => d.root === t.ref.root);
			let target: TempDef | undefined;
			if (t.forward)
				target = list.find(d => d.seq >= t.seq);
			else {
				for (const d of list) {
					if (d.seq >= t.seq)
						break;
					target = d;
				}
			}
			t.ref.key = target?.key;
			this.storeRef(t.ref);
		}
	}
}


/** Removes entries with the same key and location. */
function uniqueByLocation<T extends {file: string, line: number, start: number, key?: string}>(list: T[]): T[] {
	const seen = new Set<string>();
	return list.filter(e => {
		const id = `${e.key}|${fileKey(e.file)}|${e.line}|${e.start}`;
		if (seen.has(id))
			return false;
		seen.add(id);
		return true;
	});
}
