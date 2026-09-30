import * as path from 'path';
import * as vscode from 'vscode';
import {ProjectManager} from './projectmanager';
import {keyName, kindText} from './symbols';


/// Output to the vscode "OUTPUT" tab.
const output = vscode.window.createOutputChannel("sjasmplus Code Lens");


/** Kinds checked for references. */
const CHECKED_KINDS = new Set(['label', 'data', 'equ', 'defl', 'struct', 'field', 'macro']);


/**
 * Static user command functions.
 * - findLabelsWithNoReference: Searches all labels and shows the ones that are not referenced.
 */
export class Commands {

    /**
     * Searches all labels, structs, fields and macros of the project of the
     * document and prints the ones that are not referenced.
     * @param projects The project manager.
     * @param document A document of the project.
     */
    public static async findLabelsWithNoReference(projects: ProjectManager, document: vscode.TextDocument): Promise<void> {
        const project = await projects.getProject(document);
        if (!project)
            return;
        const folder = vscode.workspace.getWorkspaceFolder(document.uri);
        const baseDir = folder?.uri.fsPath ?? path.dirname(document.fileName);
        output.appendLine('Unreferenced labels in ' + path.basename(baseDir) + ':');
        output.show(true);

        const unreferenced = project.getAllDefinitions()
            .filter(d => CHECKED_KINDS.has(d.kind) && project.getReferences(d.key).length === 0)
            .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
        for (const def of unreferenced)
            output.appendLine(`${keyName(def.key)} (${kindText(def.kind)}), ${path.relative(baseDir, def.file)}:${def.line + 1}`);

        const count = unreferenced.length;
        output.appendLine(count === 0 ? 'None.' : `Done. ${count} unreferenced label${count === 1 ? '' : 's'}.`);
        output.appendLine('');
    }
}
