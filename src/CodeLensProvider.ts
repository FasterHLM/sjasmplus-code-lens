import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {toLocation} from './symbols';



/**
 * A CodeLens for the assembler files.
 * Extends CodeLens by the TextDocument and the symbol key.
 */
class AsmCodeLens extends vscode.CodeLens {
    constructor(public document: vscode.TextDocument, range: vscode.Range, public key: string) {
        super(range);
    }
}


/** Symbol kinds that get a code lens. */
const LENS_KINDS = new Set(['label', 'data', 'equ', 'defl', 'struct', 'field', 'macro', 'define']);


/**
 * CodeLensProvider for assembly language.
 * Shows the number of references above each label, struct, macro etc.
 */
export class CodeLensProvider implements vscode.CodeLensProvider {
    public onDidChangeCodeLenses: vscode.Event<void>;

    constructor(protected projects: ProjectManager) {
        // Counts in one file change with edits in other files
        this.onDidChangeCodeLenses = projects.onDidChange;
    }


    /**
     * Called from vscode to provide the code lenses.
     * Code lenses are provided unresolved.
     * @param document The document to check.
     * @param token
     */
    public async provideCodeLenses(document: vscode.TextDocument, _token: vscode.CancellationToken): Promise<vscode.CodeLens[] | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableCodeLenses)
            return undefined;
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;

        const codeLenses: vscode.CodeLens[] = [];
        for (const def of project.getDefinitionsInFile(document.fileName)) {
            if (!LENS_KINDS.has(def.kind))
                continue;
            const range = new vscode.Range(def.line, def.start, def.line, def.end);
            codeLenses.push(new AsmCodeLens(document, range, def.key));
        }
        return codeLenses;
    }


    /**
     * Called by vscode if the codelens should be resolved (displayed).
     * Counts the references and presents them with the text "n references".
     * @param codeLens An AsmCodeLens object which also includes the symbol and the document.
     * @param token
     */
    public async resolveCodeLens(codeLens: AsmCodeLens, _token: vscode.CancellationToken): Promise<vscode.CodeLens> {
        const project = await this.projects.getProject(codeLens.document);
        const locations = project?.getReferences(codeLens.key).map(toLocation) ?? [];
        const count = locations.length;
        codeLens.command = {
            title: count + (count === 1 ? ' reference' : ' references'),
            command: 'editor.action.showReferences',
            arguments: [codeLens.document.uri, codeLens.range.start, locations]
        };
        return codeLens;
    }
}
