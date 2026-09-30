import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {keysAt, toLocation} from './symbols';



/**
 * ReferenceProvider for assembly language.
 */
export class ReferenceProvider implements vscode.ReferenceProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Called from vscode if the user selects "Find all references".
     * @param document The current document.
     * @param position The position of the word for which the references should be found.
     * @param options
     * @param token
     */
    public async provideReferences(document: vscode.TextDocument, position: vscode.Position, options: {includeDeclaration: boolean}, _token: vscode.CancellationToken): Promise<vscode.Location[] | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableFindAllReferences)
            return undefined;
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;

        const locations: vscode.Location[] = [];
        for (const {keys} of keysAt(project, document.fileName, position)) {
            for (const key of keys) {
                if (options.includeDeclaration)
                    locations.push(...project.getDefinitions(key).filter(d => !d.synthetic).map(toLocation));
                locations.push(...project.getReferences(key).map(toLocation));
            }
        }
        return locations;
    }
}
