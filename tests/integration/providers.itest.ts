/**
 * Integration tests: the providers inside VS Code, on the project in ./fixture.
 */
import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';


const fixture = path.resolve(__dirname, '../../../tests/integration/fixture');
const mainUri = vscode.Uri.file(path.join(fixture, 'main.asm'));
const utilUri = vscode.Uri.file(path.join(fixture, 'util.asm'));


/** Position of the n-th occurrence of 'text' in the document, plus 'offset' characters. */
function pos(doc: vscode.TextDocument, text: string, offset = 0, nth = 0): vscode.Position {
	const content = doc.getText();
	let i = -1;
	for (let k = 0; k <= nth; k++) {
		i = content.indexOf(text, i + 1);
		assert.ok(i >= 0, `'${text}' not found`);
	}
	return doc.positionAt(i + offset);
}

function lines(locations: (vscode.Location | vscode.LocationLink)[]): string[] {
	return locations.map(l => {
		const uri = 'uri' in l ? l.uri : l.targetUri;
		const range = 'range' in l ? l.range : l.targetRange;
		return `${path.basename(uri.fsPath)}:${range.start.line}`;
	}).sort();
}


suite('sjasmplus Code Lens in VS Code', () => {
	let main: vscode.TextDocument;
	let util: vscode.TextDocument;

	suiteSetup(async () => {
		main = await vscode.workspace.openTextDocument(mainUri);
		util = await vscode.workspace.openTextDocument(utilUri);
		assert.equal(main.languageId, 'sjasmplus');
		const ext = vscode.extensions.getExtension('kolnogorov.sjasmplus-code-lens');
		assert.ok(ext, 'extension not found');
		await ext.activate();
	});

	test('go to definition', async () => {
		const defs = async (p: vscode.Position) => lines(await vscode.commands.executeCommand('vscode.executeDefinitionProvider', mainUri, p));
		// "clear" of util.clear -> label, "util" of util.clear -> module
		assert.deepEqual(await defs(pos(main, 'util.clear', 6)), ['util.asm:2']);
		assert.deepEqual(await defs(pos(main, 'util.clear', 1)), ['util.asm:0']);
		assert.deepEqual(await defs(pos(main, 'util.clear.fast', 12)), ['util.asm:3']);
		assert.deepEqual(await defs(pos(main, 'jr .loop', 4)), ['main.asm:8']);
		assert.deepEqual(await defs(pos(main, 'screen.base', 8)), ['util.asm:7']);
		// INCLUDE opens the file
		assert.deepEqual(await defs(pos(main, 'util.asm', 1)), ['util.asm:0']);
		// Struct instance field: the instance and the struct field
		assert.deepEqual(await defs(pos(main, 'pos.x', 4)), ['main.asm:14', 'main.asm:18']);
	});

	test('find all references', async () => {
		const refs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', utilUri, pos(util, 'clear:'));
		assert.deepEqual(lines(refs), ['main.asm:5', 'util.asm:2']);
		const fieldRefs: vscode.Location[] = await vscode.commands.executeCommand('vscode.executeReferenceProvider', mainUri, pos(main, 'x\tBYTE'));
		assert.deepEqual(lines(fieldRefs), ['main.asm:14', 'main.asm:19']);
	});

	test('code lenses', async () => {
		const lenses: vscode.CodeLens[] = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', utilUri, 100);
		const titles = lenses.map(l => `${l.range.start.line}:${l.command?.title}`).sort();
		assert.deepEqual(titles, ['2:1 reference', '3:1 reference', '7:1 reference']);
	});

	test('hover', async () => {
		const hovers: vscode.Hover[] = await vscode.commands.executeCommand('vscode.executeHoverProvider', mainUri, pos(main, 'util.clear', 7));
		const text = hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
		assert.ok(text.includes('util.clear'), text);
		assert.ok(text.includes('Clears the screen'), text);
	});

	test('hover shows the value of a constant, and the forms of a number', async () => {
		const textOf = (hovers: vscode.Hover[]) => hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
		// "ld hl,screen.base": screen.base is "equ #4000" in util.asm
		const constant = textOf(await vscode.commands.executeCommand('vscode.executeHoverProvider', mainUri, pos(main, 'ld hl,screen.base', 14)));
		assert.ok(constant.includes('16384 (0x4000, %0100000000000000)'), constant);
		// "ld hl,#4000" in util.asm: a number that is not a symbol
		const number = textOf(await vscode.commands.executeCommand('vscode.executeHoverProvider', utilUri, pos(util, 'ld hl,#4000', 8)));
		assert.ok(number.includes('16384 (0x4000, %0100000000000000)'), number);
		// a label that is not a constant has no value
		const label = textOf(await vscode.commands.executeCommand('vscode.executeHoverProvider', mainUri, pos(main, 'util.clear', 7)));
		assert.ok(!label.includes('16384'), label);
	});

	test('hover: the value at a definition, the prefix of the setting, and no forms where a number is not a number', async () => {
		const textOf = (hovers: vscode.Hover[]) => hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n');
		const sourceUri = vscode.Uri.file(path.join(fixture, 'hovervalues.asm'));
		const listingUri = vscode.Uri.file(path.join(fixture, 'hovervalues.lst'));
		const source = await vscode.workspace.openTextDocument(sourceUri);
		const listing = await vscode.workspace.openTextDocument(listingUri);
		assert.equal(source.languageId, 'sjasmplus');
		assert.equal(listing.languageId, 'sjasmplus-list');
		const hover = async (doc: vscode.TextDocument, text: string, offset = 0) =>
			textOf(await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos(doc, text, offset)));
		// the value at the definition itself, and a number in code
		assert.ok((await hover(source, 'SIZE\tequ', 1)).includes('32 (0x20, %00100000)'));
		assert.ok((await hover(source, '#FF', 1)).includes('255 (0xFF, %11111111)'));
		// no forms in a comment, in a string, on a temporary label, in a block comment, in Lua, and in a listing
		const nothing = async (doc: vscode.TextDocument, text: string, offset: number, where: string) =>
			assert.ok(!(await hover(doc, text, offset)).includes('(0x'), where);
		await nothing(source, '12345', 1, 'a comment');
		await nothing(source, 'with 99', 6, 'a comment after code');
		await nothing(source, '"7"', 1, 'a string');
		await nothing(source, 'djnz\t1B', 6, 'a reference to a temporary label');
		await nothing(source, '42', 1, 'the first line of a block comment');
		await nothing(source, 'with 77', 6, 'a line inside a block comment');
		await nothing(source, 'x = 55', 5, 'Lua');
		await nothing(listing, '8000', 1, 'an address in a listing');
		await nothing(listing, '3E 01', 0, 'a byte in a listing');
		// the prefix of hex numbers is the one of the setting hexCalculator.hexPrefix
		const settings = vscode.workspace.getConfiguration('sjasmplus-code-lens');
		await settings.update('hexCalculator.hexPrefix', '#', vscode.ConfigurationTarget.Global);
		try {
			assert.ok((await hover(source, '#FF', 1)).includes('255 (#FF, %11111111)'));
			assert.ok((await hover(source, 'SIZE\tequ', 1)).includes('32 (#20, %00100000)'));
		}
		finally {
			await settings.update('hexCalculator.hexPrefix', undefined, vscode.ConfigurationTarget.Global);
		}
		assert.ok((await hover(source, '#FF', 1)).includes('255 (0xFF, %11111111)'));
	});

	test('outline', async () => {
		const symbols: vscode.DocumentSymbol[] = await vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', utilUri);
		const tree = (s: vscode.DocumentSymbol): string => s.name + (s.children.length ? '(' + s.children.map(tree).join(',') + ')' : '');
		assert.deepEqual(symbols.map(tree), ['util(clear(.fast))', 'screen(base)']);
	});

	test('workspace symbols', async () => {
		const symbols: vscode.SymbolInformation[] = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'clear');
		assert.deepEqual(symbols.map(s => s.name).sort(), ['util.clear', 'util.clear.fast']);
	});

	test('completion of local labels', async () => {
		const list: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', mainUri, pos(main, 'jr .loop', 5));
		const labels = list.items.map(i => typeof i.label === 'string' ? i.label : i.label.label);
		assert.ok(labels.includes('.loop'), labels.join(' '));
		// Global labels, module members, structs and keywords when typing a name
		const global: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', mainUri, pos(main, 'call util.clear', 7));
		const globalLabels = global.items.map(i => typeof i.label === 'string' ? i.label : i.label.label);
		for (const expected of ['start', 'util.clear', 'util.clear.fast', 'screen.base', 'POINT', 'call'])
			assert.ok(globalLabels.includes(expected), expected + ' missing');
		// Triggered by typing the dot alone
		const afterDot: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', mainUri, pos(main, 'jr .loop', 4), '.');
		assert.ok(afterDot.items.some(i => i.label === '.loop'), 'after "."');
	});

	test('folding', async () => {
		const ranges: vscode.FoldingRange[] = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', mainUri);
		assert.ok(ranges.some(r => r.start === 13 && r.end === 16), 'STRUCT..ENDS');
	});

	test('the formatter of sjasmplus files by default, the DeZog context menu commands', async () => {
		const formatter = () => vscode.workspace.getConfiguration('editor', {languageId: 'sjasmplus'}).get('defaultFormatter');
		assert.equal(formatter(), 'kolnogorov.sjasmplus-code-lens');
		// Also when the user settings name another formatter for all languages
		await vscode.workspace.getConfiguration('editor').update('defaultFormatter', 'maziac.asm-code-lens', vscode.ConfigurationTarget.Global);
		try {
			assert.equal(formatter(), 'kolnogorov.sjasmplus-code-lens');
		}
		finally {
			await vscode.workspace.getConfiguration('editor').update('defaultFormatter', undefined, vscode.ConfigurationTarget.Global);
		}
		const commands = await vscode.commands.getCommands(true);
		assert.ok(commands.includes('sjasmplus-code-lens.dezog.movePCtoCursor'));
		assert.ok(commands.includes('sjasmplus-code-lens.dezog.analyzeAtCursor.callGraph'));
	});

	test('rename', async () => {
		const edit: vscode.WorkspaceEdit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', utilUri, pos(util, 'clear:'), 'cls');
		const changes = edit.entries().flatMap(([uri, edits]) => edits.map(e => `${path.basename(uri.fsPath)}:${e.range.start.line}:${e.range.start.character}-${e.range.end.character}=${e.newText}`)).sort();
		// util.clear -> util.cls, util.clear.fast -> util.cls.fast, the definition
		assert.deepEqual(changes, ['main.asm:5:17-22=cls', 'main.asm:6:11-16=cls', 'util.asm:2:0-5=cls']);
	});

	test('diagnostics', async () => {
		// Published after the project is loaded (debounced)
		let diagnostics: vscode.Diagnostic[] = [];
		for (let i = 0; i < 50 && diagnostics.length === 0; i++) {
			await new Promise(resolve => setTimeout(resolve, 100));
			diagnostics = vscode.languages.getDiagnostics(mainUri);
		}
		// Only the active reference, not the one in the IFDEF block of an undefined define
		assert.deepEqual(diagnostics.map(d => `${d.range.start.line}:${d.message}`), ['21:Label not found: not_defined']);
	});

	test('semantic tokens', async () => {
		const legend: vscode.SemanticTokensLegend = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokensLegend', mainUri);
		const tokens: vscode.SemanticTokens = await vscode.commands.executeCommand('vscode.provideDocumentSemanticTokens', mainUri);
		// Decode the relative encoding into "line:char text type[.modifiers]"
		const decoded: string[] = [];
		let line = 0, char = 0;
		for (let i = 0; i < tokens.data.length; i += 5) {
			const [dLine, dChar, length, type, mods] = tokens.data.slice(i, i + 5);
			line += dLine;
			char = dLine === 0 ? char + dChar : dChar;
			const modifiers = legend.tokenModifiers.filter((m, k) => mods & (1 << k));
			decoded.push(`${line}:${main.lineAt(line).text.substr(char, length)} ${[legend.tokenTypes[type], ...modifiers].join('.')}`);
		}
		for (const expected of ['5:start function.declaration', '5:util namespace', '5:clear function', '7:screen namespace', '7:base variable.readonly', '13:POINT struct.declaration', '19:pos variable', '19:x property'])
			assert.ok(decoded.includes(expected), expected + ' missing in ' + decoded.join(', '));
	});

	test('format document', async () => {
		const uri = vscode.Uri.file(path.join(fixture, 'format.asm'));
		const doc = await vscode.workspace.openTextDocument(uri);
		const edits: vscode.TextEdit[] = await vscode.commands.executeCommand('vscode.executeFormatDocumentProvider', uri, {tabSize: 8, insertSpaces: false});
		// VS Code reduces the edits to the changed parts: apply them from the end
		let text = doc.getText();
		for (const e of [...edits].sort((a, b) => doc.offsetAt(b.range.start) - doc.offsetAt(a.range.start)))
			text = text.substring(0, doc.offsetAt(e.range.start)) + e.newText + text.substring(doc.offsetAt(e.range.end));
		assert.deepEqual(text.split('\n'), ['\tnop', '\tinc a', '\tld a , b\t; c', 'label:\tret', '']);
	});

	test('no color decorators for hex numbers', async () => {
		// VS Code's default color provider takes #4000 or #FF0000 for colors
		assert.equal(vscode.workspace.getConfiguration('editor', main).get('colorDecorators'), false);
	});

	test('closing of block comments can be turned off', async () => {
		const typeComment = async () => {
			const doc = await vscode.workspace.openTextDocument({language: 'sjasmplus', content: ''});
			await vscode.window.showTextDocument(doc);
			await vscode.commands.executeCommand('type', {text: '/'});
			await vscode.commands.executeCommand('type', {text: '*'});
			const text = doc.getText().replace(/\r\n/g, '\n');
			await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
			return text;
		};
		assert.equal(await typeComment(), '/*\n*/');
		const editor = vscode.workspace.getConfiguration('editor', {languageId: 'sjasmplus'});
		await editor.update('autoClosingComments', 'never', vscode.ConfigurationTarget.Global, true);
		try {
			assert.equal(await typeComment(), '/*');
		}
		finally {
			await editor.update('autoClosingComments', undefined, vscode.ConfigurationTarget.Global, true);
		}
	});

	test('quick fixes for a label that is not found: another module, a typo, nothing alike', async () => {
		const fixUri = vscode.Uri.file(path.join(fixture, 'quickfix.asm'));
		const doc = await vscode.workspace.openTextDocument(fixUri);
		await vscode.window.showTextDocument(doc);
		// "call wipe" is on line 6, "call bgein" on 7, "call nothing_alike" on 8
		const diagnosticLines = async (expected: number[]) => {
			let seen: number[] = [];
			for (let i = 0; i < 50; i++) {
				seen = vscode.languages.getDiagnostics(fixUri).map(d => d.range.start.line).sort((a, b) => a - b);
				if (seen.join() === expected.join())
					break;
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			return seen;
		};
		assert.deepEqual(await diagnosticLines([6, 7, 8]), [6, 7, 8]);
		const fixes = async (line: number) => {
			const actions: vscode.CodeAction[] = await vscode.commands.executeCommand('vscode.executeCodeActionProvider', fixUri, new vscode.Range(line, 0, line, 30), vscode.CodeActionKind.QuickFix.value);
			return actions.filter(a => a.kind?.value === 'quickfix');
		};
		const wipe = await fixes(6);
		assert.deepEqual(wipe.map(a => a.title), ["Change to 'tools.wipe'"]);
		assert.equal(wipe[0].isPreferred, true, 'the only suggestion is the preferred fix');
		assert.deepEqual((await fixes(7)).map(a => a.title), ["Change to 'begin'"]);
		assert.deepEqual((await fixes(8)).map(a => a.title), [], 'nothing alike: no fix');
		// the fix replaces the name and the warning goes
		assert.ok(await vscode.workspace.applyEdit(wipe[0].edit!));
		assert.equal(doc.lineAt(6).text, '\tcall tools.wipe');
		assert.deepEqual(await diagnosticLines([7, 8]), [7, 8]);
		await vscode.commands.executeCommand('workbench.action.files.revert');
	});

	test('code lens follows edits', async () => {
		const editor = await vscode.window.showTextDocument(main);
		await editor.edit(b => b.insert(new vscode.Position(10, 0), '\tcall util.clear\n'));
		const lenses: vscode.CodeLens[] = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', utilUri, 100);
		const clear = lenses.find(l => l.range.start.line === 2);
		assert.equal(clear?.command?.title, '2 references');
		await vscode.commands.executeCommand('workbench.action.files.revert');
	});

	test('the setting codeLensKinds chooses the symbols that get a code lens', async () => {
		const lensLines = async (uri: vscode.Uri, expected: number[]) => {
			let seen: number[] = [];
			for (let i = 0; i < 50; i++) {
				const lenses: vscode.CodeLens[] = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', uri, 100);
				seen = lenses.map(l => l.range.start.line).sort((a, b) => a - b);
				if (seen.join() === expected.join())
					break;
				await new Promise(resolve => setTimeout(resolve, 100));
			}
			return seen;
		};
		// A file of the workspace, util.asm: the labels clear (line 2) and .fast (3), the constant screen.base (7)
		// kinds.asm: a define (line 1), a label (2), a constant (3), a macro (4)
		const kindsUri = vscode.Uri.file(path.join(fixture, 'kinds.asm'));
		await vscode.workspace.openTextDocument(kindsUri);
		const settings = vscode.workspace.getConfiguration('sjasmplus-code-lens');
		assert.deepEqual(await lensLines(utilUri, [2, 3, 7]), [2, 3, 7], 'all symbols by default');
		assert.deepEqual(await lensLines(kindsUri, [1, 2, 3, 4]), [1, 2, 3, 4], 'all symbols by default, also the define');
		try {
			await settings.update('codeLensKinds', ['constants'], vscode.ConfigurationTarget.Global);
			assert.deepEqual(await lensLines(utilUri, [7]), [7], 'constants only');
			await settings.update('codeLensKinds', ['labels'], vscode.ConfigurationTarget.Global);
			assert.deepEqual(await lensLines(utilUri, [2, 3]), [2, 3], 'labels only');
			await settings.update('codeLensKinds', ['labels', 'constants', 'macros'], vscode.ConfigurationTarget.Global);
			assert.deepEqual(await lensLines(kindsUri, [2, 3, 4]), [2, 3, 4], 'everything but the defines');
			await settings.update('codeLensKinds', ['defines'], vscode.ConfigurationTarget.Global);
			assert.deepEqual(await lensLines(kindsUri, [1]), [1], 'defines only');
			await settings.update('codeLensKinds', [], vscode.ConfigurationTarget.Global);
			assert.deepEqual(await lensLines(utilUri, []), [], 'an empty list: none');
		}
		finally {
			await settings.update('codeLensKinds', undefined, vscode.ConfigurationTarget.Global);
		}
		assert.deepEqual(await lensLines(utilUri, [2, 3, 7]), [2, 3, 7], 'back to all symbols');
	});
});


suite('sjasmplus Code Lens in VS Code: labels made by macros, EXIST', () => {
	const macrosUri = vscode.Uri.file(path.join(fixture, 'macros.asm'));
	let macros: vscode.TextDocument;

	suiteSetup(async () => {
		macros = await vscode.workspace.openTextDocument(macrosUri);
		assert.equal(macros.languageId, 'sjasmplus');
		const ext = vscode.extensions.getExtension('kolnogorov.sjasmplus-code-lens');
		assert.ok(ext, 'extension not found');
		await ext.activate();
	});

	// "call gb_exit": the label of the expansion "decode gb" of the macro label "prefix_exit"
	const madeName = () => pos(macros, 'call gb_exit', 6);

	test('go to definition leads to the label in the macro, once', async () => {
		const defs: (vscode.Location | vscode.LocationLink)[] = await vscode.commands.executeCommand('vscode.executeDefinitionProvider', macrosUri, madeName());
		assert.deepEqual(lines(defs), ['macros.asm:3']);
	});

	test('hover says that the name is made by a macro expansion', async () => {
		const hovers: vscode.Hover[] = await vscode.commands.executeCommand('vscode.executeHoverProvider', macrosUri, madeName());
		// The markdown escapes "_" as "\_": compare without the backslashes
		const text = hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n').replace(/\\/g, '');
		assert.ok(text.includes('gb_exit'), text);
		assert.ok(text.includes('Made by a macro expansion'), text);
		assert.ok(!text.includes('struct'), text);
	});

	test('the reference count above the label in the macro includes the use of the made name', async () => {
		const lenses: vscode.CodeLens[] = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', macrosUri, 100);
		const titles = lenses.map(l => `${l.range.start.line}:${l.command?.title}`);
		assert.ok(titles.includes('3:1 reference'), titles.join(', '));
	});

	test('completion and workspace symbols offer the name made by a macro', async () => {
		const list: vscode.CompletionList = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', macrosUri, pos(macros, 'call gb_exit', 8));
		const item = list.items.find(i => (typeof i.label === 'string' ? i.label : i.label.label) === 'gb_exit');
		assert.ok(item, 'gb_exit is not offered by the completion');
		assert.ok(String(item.detail).includes('made by a macro'), String(item.detail));
		const symbols: vscode.SymbolInformation[] = await vscode.commands.executeCommand('vscode.executeWorkspaceSymbolProvider', 'gb_exit');
		assert.deepEqual(symbols.map(s => `${s.name}@${path.basename(s.location.uri.fsPath)}:${s.location.range.start.line}`), ['gb_exit@macros.asm:3']);
	});

	test('rename of a name made by a macro, and of the label it is made from, is refused', async () => {
		for (const where of [madeName(), pos(macros, 'prefix_exit', 1)]) {
			let refusal = '';
			try {
				await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', macrosUri, where, 'other');
			}
			catch (e) {
				refusal = String(e);
			}
			assert.ok(refusal.includes('macro parameter'), `not refused at ${where.line}:${where.character}: '${refusal}'`);
		}
	});

	test('diagnostics: only the real mistake, not the made name, the label tested by EXIST or a block that is not assembled', async () => {
		let diagnostics: vscode.Diagnostic[] = [];
		for (let i = 0; i < 50 && diagnostics.length === 0; i++) {
			await new Promise(resolve => setTimeout(resolve, 100));
			diagnostics = vscode.languages.getDiagnostics(macrosUri);
		}
		assert.deepEqual(diagnostics.map(d => `${d.range.start.line}:${d.message}`), ['10:Label not found: not_defined_here']);
	});

	test('setting syntax "s": the name made by a macro is not made any more, and it is taken back', async () => {
		const messages = async (expected: string[]) => {
			let seen: string[] = [];
			for (let i = 0; i < 50; i++) {
				await new Promise(resolve => setTimeout(resolve, 100));
				seen = vscode.languages.getDiagnostics(macrosUri).map(d => `${d.range.start.line}:${d.message}`).sort();
				if (seen.join('|') === expected.join('|'))
					break;
			}
			return seen;
		};
		const settings = vscode.workspace.getConfiguration('sjasmplus-code-lens');
		await settings.update('syntax', 's', vscode.ConfigurationTarget.Global);
		try {
			assert.deepEqual(await messages(['10:Label not found: not_defined_here', '6:Label not found: gb_exit']), ['10:Label not found: not_defined_here', '6:Label not found: gb_exit']);
		}
		finally {
			await settings.update('syntax', undefined, vscode.ConfigurationTarget.Global);
		}
		assert.deepEqual(await messages(['10:Label not found: not_defined_here']), ['10:Label not found: not_defined_here']);
	});
});


suite('sjasmplus Code Lens in VS Code: comments in the hover', () => {
	const commentsUri = vscode.Uri.file(path.join(fixture, 'comments.asm'));
	let comments: vscode.TextDocument;

	suiteSetup(async () => {
		comments = await vscode.workspace.openTextDocument(commentsUri);
		assert.equal(comments.languageId, 'sjasmplus');
	});

	/** The hover text of the name at the end of 'use', a text of the document. The markdown escapes "_" as "\_": compare without the backslashes. */
	async function hoverText(use: string, doc = comments): Promise<string> {
		const hovers: vscode.Hover[] = await vscode.commands.executeCommand('vscode.executeHoverProvider', doc.uri, pos(doc, use, use.length - 3));
		return hovers.flatMap(h => h.contents.map(c => typeof c === 'string' ? c : c.value)).join('\n').replace(/\\/g, '');
	}

	test('the comment of the code line above is not shown', async () => {
		// "mem_buffer" is right below "mem_base ... ;start of the area" and the memory map
		const text = await hoverText('ld hl,mem_buffer');
		assert.ok(text.includes('mem_buffer'), text);
		assert.ok(!text.includes('start of the area'), text);
		assert.ok(!text.includes('Memory map'), text);
		assert.ok(!text.includes('Own comment'), text);
	});

	test('the comment lines right above the definition are shown, up to the code', async () => {
		const text = await hoverText('ld de,mem_third');
		assert.ok(text.includes('Own comment'), text);
		assert.ok(text.includes('of the third'), text);
		assert.ok(!text.includes('the buffer'), text);
		assert.ok(!text.includes('Memory map'), text);
	});

	test('the memory map is shown for the definition right below it', async () => {
		const text = await hoverText('ld bc,mem_base');
		assert.ok(text.includes('Memory map'), text);
	});

	test('list file: the same, the address columns are not code', async () => {
		const listingUri = vscode.Uri.file(path.join(fixture, 'listing.lst'));
		const listing = await vscode.workspace.openTextDocument(listingUri);
		assert.equal(listing.languageId, 'sjasmplus-list');
		const buffer = await hoverText('ld hl,lst_buffer', listing);
		assert.ok(buffer.includes('lst_buffer'), buffer);
		assert.ok(!buffer.includes('start of the area'), buffer);
		assert.ok(!buffer.includes('Memory map'), buffer);
		const third = await hoverText('ld de,lst_third', listing);
		assert.ok(third.includes('Own comment'), third);
		assert.ok(!third.includes('Memory map'), third);
		assert.ok((await hoverText('ld bc,lst_base', listing)).includes('Memory map'));
	});
});
