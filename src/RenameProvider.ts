import * as vscode from 'vscode';
import {Config} from './config';
import {ProjectManager} from './projectmanager';
import {Occurrence, Project} from './sjasm/project';
import {keyName, keysAt, segments} from './symbols';



/** Valid new names: no dots (these separate modules and local labels), no leading digit. */
const regexNewName = /^[A-Za-z_][\w!?#@]*$/;


/**
 * RenameProvider for assembly language.
 * User selects "Rename symbol".
 */
export class RenameProvider implements vscode.RenameProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Checks that a symbol is at the position and returns the part of
     * the name that is renamed.
     */
    public async prepareRename(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<{range: vscode.Range, placeholder: string} | undefined> {
        const target = await this.getTarget(document, position);
        const edit = target && this.editRange(target.occurrence, target.key);
        if (!target || !edit)
            throw new Error('Nothing to rename here.');
        const placeholder = keyName(target.key).split('.').pop()!;
        return {range: new vscode.Range(edit.line, edit.start, edit.line, edit.end), placeholder};
    }


    /**
     * Called from vscode if the user selects "Rename symbol".
     * @param document The current document.
     * @param position The position of the symbol.
     * @param newName The new name (last part of the full name).
     */
    public async provideRenameEdits(document: vscode.TextDocument, position: vscode.Position, newName: string, _token: vscode.CancellationToken): Promise<vscode.WorkspaceEdit | undefined> {
        if (!regexNewName.test(newName))
            throw new Error(`'${newName}' is not a valid name. Use letters, digits and '_' (no dots).`);
        const target = await this.getTarget(document, position);
        if (!target)
            throw new Error('Nothing to rename here.');

        const wsEdit = new vscode.WorkspaceEdit();
        const done = new Set<string>();
        for (const occ of this.collectOccurrences(target.project, target.key)) {
            const edit = this.editRange(occ, target.key, target.project);
            if (!edit)
                continue;
            const id = `${occ.file}|${edit.line}|${edit.start}`;
            if (done.has(id))
                continue;
            done.add(id);
            wsEdit.replace(vscode.Uri.file(occ.file), new vscode.Range(edit.line, edit.start, edit.line, edit.end), newName);
        }
        return wsEdit;
    }


    /** The symbol to rename at the position. */
    protected async getTarget(document: vscode.TextDocument, position: vscode.Position): Promise<{project: Project, key: string, occurrence: Occurrence} | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableRenaming)
            throw new Error('Renaming is disabled for this workspace folder.');
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;
        for (const {occurrence, keys} of keysAt(project, document.fileName, position)) {
            const key = keys[0];
            if (!key)
                continue;
            if (key.startsWith('T:'))
                throw new Error('Temporary labels cannot be renamed.');
            // Names built from a macro parameter ("tag_x" with tag=gb gives "gb_x"): a rename would
            // change the uses but not what the macro makes (or the other way round)
            const defs = project.getDefinitions(key);
            if (defs.length > 0 && defs.every(d => d.synthetic && d.kind !== 'field'))
                throw new Error('This name is made by a macro expansion from a macro parameter: rename the label in the macro or the argument of the invocation by hand.');
            if (project.getDerivedKeys(key).some(k => project.getDefinitions(k).some(d => d.kind !== 'field')))
                throw new Error('This label is built from a macro parameter and is used with the argument in its name: rename it by hand, together with its uses.');
            return {project, key, occurrence};
        }
        return undefined;
    }


    /** All occurrences that may contain a part to rename. */
    protected collectOccurrences(project: Project, key: string): Occurrence[] {
        // Labels, structs and modules: the name can be part of longer names (locals, fields, qualified references)
        if (key.startsWith('L:') || key.startsWith('M:'))
            return project.getAllOccurrences().filter(o => o.key && (o.key.startsWith('L:') || o.key.startsWith('M:')));
        return project.getAllOccurrences().filter(o => o.key === key);
    }


    /**
     * Returns the range of the part of an occurrence that belongs to the
     * renamed symbol, or undefined if the occurrence does not contain it.
     */
    protected editRange(occ: Occurrence, key: string, project?: Project): {line: number, start: number, end: number} | undefined {
        if (!occ.key)
            return undefined;
        const segs = segments(occ.written);
        const last = segs[segs.length - 1];
        const whole = {line: occ.line, start: occ.start + segs[0].offset, end: occ.start + last.offset + last.text.length};

        const ns = key.substring(0, key.indexOf(':') + 1);
        if (ns !== 'L:' && ns !== 'M:')
            return occ.key === key ? {line: occ.line, start: occ.start + prefixOf(occ.written, key), end: occ.end} : undefined;

        // Struct instance fields: the last part is the field name
        if (project && occ.key !== key && project.getDerivedKeys(key).includes(occ.key))
            return {line: occ.line, start: occ.start + last.offset, end: whole.end};

        const target = keyName(key).split('.');
        const full = keyName(occ.key).split('.');
        if (full.length < target.length || target.some((t, i) => full[i] !== t))
            return undefined;
        const index = target.length - 1 - (full.length - segs.length);
        if (index < 0 || index >= segs.length)
            return undefined;
        const seg = segs[index];
        return {line: occ.line, start: occ.start + seg.offset, end: occ.start + seg.offset + seg.text.length};
    }
}


/** Length of the prefix of macro locals ('.'), defines and macros (none). */
function prefixOf(written: string, key: string): number {
    return key.startsWith('ML:') && written.startsWith('.') ? 1 : 0;
}
