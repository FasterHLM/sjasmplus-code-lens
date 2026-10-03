import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {guessDefinitions, keysAt, toLocation} from './symbols';



/**
 * DefinitionProvider for assembly language.
 * Called from vscode e.g. for "Goto definition".
 */
export class DefinitionProvider implements vscode.DefinitionProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Called from vscode if the user selects "Goto definition".
     * @param document The current document.
     * @param position The position of the word for which the definition should be found.
     * @param token
     */
    public async provideDefinition(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableGotoDefinition)
            return undefined;
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;

        // INCLUDE "file": go to the file
        const include = project.includeAt(document.fileName, position.line, position.character);
        if (include) {
            if (!include.target)
                return undefined;
            return [new vscode.Location(vscode.Uri.file(include.target), new vscode.Position(0, 0))];
        }

        const locations: vscode.Location[] = [];
        for (const {occurrence, keys} of keysAt(project, document.fileName, position)) {
            if (keys.length === 0) {
                // Unresolved: best guess by name
                locations.push(...guessDefinitions(project, occurrence.written).map(toLocation));
                continue;
            }
            for (const key of keys) {
                for (const def of project.getDefinitions(key)) {
                    locations.push(toLocation(def));
                    // Struct instance field: also the field in the struct
                    if (def.derivedFrom)
                        locations.push(...project.getDefinitions(def.derivedFrom).map(toLocation));
                }
            }
        }
        // A name made by a macro expansion is defined at the same place as the label in the macro
        const seen = new Set<string>();
        return locations.filter(l => {
            const id = `${l.uri.toString()}|${l.range.start.line}|${l.range.start.character}`;
            if (seen.has(id))
                return false;
            seen.add(id);
            return true;
        });
    }
}
