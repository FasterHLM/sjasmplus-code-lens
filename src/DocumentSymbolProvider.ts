import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {SymbolDef} from './sjasm/project';
import {isLocal, keyName, kindText, symbolKind} from './symbols';


/** Kinds shown in the outline. */
const OUTLINE_KINDS = new Set(['label', 'data', 'equ', 'defl', 'struct', 'field', 'macro', 'module', 'define']);


/**
 * DocumentSymbolProvider for assembly language (outline view, breadcrumbs).
 * Modules contain their labels, labels their local labels, structs their fields.
 */
export class DocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    constructor(protected projects: ProjectManager) {
    }


    public async provideDocumentSymbols(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.DocumentSymbol[] | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableOutlineView)
            return undefined;
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;

        const defs = project.getDefinitionsInFile(document.fileName)
            .filter(d => OUTLINE_KINDS.has(d.kind))
            .sort((a, b) => a.line - b.line || a.start - b.start);

        const lastLine = Math.max(0, document.lineCount - 1);
        const roots: vscode.DocumentSymbol[] = [];
        // Open containers: modules (with their full name), the last non-local label, the current struct
        const modules: {name: string, symbol: vscode.DocumentSymbol}[] = [];
        let lastLabel: vscode.DocumentSymbol | undefined;
        let struct: {def: SymbolDef, symbol: vscode.DocumentSymbol} | undefined;
        // Symbols whose range still has to be closed at the next sibling
        const open: vscode.DocumentSymbol[] = [];

        const add = (parent: vscode.DocumentSymbol | undefined, symbol: vscode.DocumentSymbol) => {
            (parent ? parent.children : roots).push(symbol);
        };
        const container = (module: string) => {
            while (modules.length > 0 && module !== modules[modules.length - 1].name && !module.startsWith(modules[modules.length - 1].name + '.'))
                modules.pop();
            return modules[modules.length - 1]?.symbol;
        };

        for (const def of defs) {
            const selection = new vscode.Range(def.line, def.start, def.line, def.end);
            const range = new vscode.Range(def.line, 0, def.line, document.lineAt(def.line).text.length);
            const name = def.kind === 'module' ? def.written : def.written || ' ';
            const detail = this.detail(def);
            const symbol = new vscode.DocumentSymbol(name, detail, symbolKind(def), range, selection);

            if (def.kind === 'module') {
                add(container(def.module.substring(0, Math.max(0, def.module.lastIndexOf('.')))), symbol);
                modules.push({name: def.module, symbol});
                lastLabel = undefined;
                struct = undefined;
                continue;
            }
            if (def.kind === 'field' && struct && def.name.startsWith(struct.def.name + '.')) {
                struct.symbol.children.push(symbol);
                continue;
            }
            if (isLocal(def) && lastLabel) {
                lastLabel.children.push(symbol);
                continue;
            }

            // Top level of the current module: close the previous symbols
            for (const s of open.splice(0))
                s.range = new vscode.Range(s.range.start, new vscode.Position(Math.max(s.range.start.line, def.line - 1), 0));
            add(container(def.module), symbol);
            open.push(symbol);
            if (def.kind === 'struct') {
                struct = {def, symbol};
                lastLabel = symbol;
            }
            else if (def.kind !== 'macro' && def.kind !== 'define') {
                struct = undefined;
                if (!def.written.startsWith('!'))
                    lastLabel = symbol;
            }
        }
        for (const s of open)
            s.range = new vscode.Range(s.range.start, new vscode.Position(lastLine, 0));

        // A parent range must contain its children
        const fix = (symbols: vscode.DocumentSymbol[]) => {
            for (const s of symbols) {
                fix(s.children);
                for (const c of s.children)
                    s.range = s.range.union(c.range);
            }
        };
        fix(roots);
        return roots;
    }


    protected detail(def: SymbolDef): string {
        const full = keyName(def.key);
        if (def.kind === 'module' || def.kind === 'macro' || def.kind === 'define')
            return kindText(def.kind);
        return full !== def.written ? full : '';
    }
}
