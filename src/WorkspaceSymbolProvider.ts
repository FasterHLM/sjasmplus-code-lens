import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {keyName, symbolKind, toLocation} from './symbols';


/** Kinds offered by "Open symbol by name". */
const SYMBOL_KINDS = new Set(['label', 'data', 'equ', 'defl', 'struct', 'field', 'macro', 'module', 'define']);


/**
 * The WorkspaceSymbolProvider ("Go to Symbol in Workspace", '#' in the quick open).
 */
export class WorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Project-wide search for a symbol matching the given query string.
     * The characters of the query have to appear in order (case-insensitive),
     * vscode does the ranking.
     * @param query A query string.
     * @param token A cancellation token.
     */
    public async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        const symbols: vscode.SymbolInformation[] = [];
        const folders = vscode.workspace.workspaceFolders ?? [];
        const projects = await this.projects.getFolderProjects();
        const lowerQuery = query.toLowerCase();
        projects.forEach((project, i) => {
            const config = Config.configs.get(folders[i]?.uri.fsPath);
            if (!config?.enableWorkspaceSymbols || query.length < config.workspaceSymbolsRequiredLength)
                return;
            for (const def of [...project.getAllDefinitions(), ...project.getMadeDefinitions()]) {
                if (token.isCancellationRequested)
                    return;
                if (!SYMBOL_KINDS.has(def.kind))
                    continue;
                const name = keyName(def.key);
                if (!fuzzyMatch(name.toLowerCase(), lowerQuery))
                    continue;
                symbols.push(new vscode.SymbolInformation(name, symbolKind(def), def.module, toLocation(def)));
            }
        });
        return symbols;
    }
}


/** True if all characters of 'query' appear in 'text' in the same order. */
function fuzzyMatch(text: string, query: string): boolean {
    let i = 0;
    for (const ch of query) {
        i = text.indexOf(ch, i);
        if (i < 0)
            return false;
        i++;
    }
    return true;
}
