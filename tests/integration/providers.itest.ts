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
	});

	test('folding', async () => {
		const ranges: vscode.FoldingRange[] = await vscode.commands.executeCommand('vscode.executeFoldingRangeProvider', mainUri);
		assert.ok(ranges.some(r => r.start === 13 && r.end === 16), 'STRUCT..ENDS');
	});

	test('rename', async () => {
		const edit: vscode.WorkspaceEdit = await vscode.commands.executeCommand('vscode.executeDocumentRenameProvider', utilUri, pos(util, 'clear:'), 'cls');
		const changes = edit.entries().flatMap(([uri, edits]) => edits.map(e => `${path.basename(uri.fsPath)}:${e.range.start.line}:${e.range.start.character}-${e.range.end.character}=${e.newText}`)).sort();
		// util.clear -> util.cls, util.clear.fast -> util.cls.fast, the definition
		assert.deepEqual(changes, ['main.asm:5:17-22=cls', 'main.asm:6:11-16=cls', 'util.asm:2:0-5=cls']);
	});

	test('code lens follows edits', async () => {
		const editor = await vscode.window.showTextDocument(main);
		await editor.edit(b => b.insert(new vscode.Position(10, 0), '\tcall util.clear\n'));
		const lenses: vscode.CodeLens[] = await vscode.commands.executeCommand('vscode.executeCodeLensProvider', utilUri, 100);
		const clear = lenses.find(l => l.range.start.line === 2);
		assert.equal(clear?.command?.title, '2 references');
		await vscode.commands.executeCommand('workbench.action.files.revert');
	});
});
