import * as vscode from 'vscode';
import * as path from 'path';
import {Config} from './config';
import {readCommentsForLine} from './comments';
import {ProjectManager} from './projectmanager';
import {keyName, keysAt, kindText} from './symbols';
import {Project, SymbolDef} from './sjasm/project';


/**
 * HoverProvider for assembly language.
 * Shows the definition line, the comments above it and the full name.
 */
export class HoverProvider implements vscode.HoverProvider {
    constructor(protected projects: ProjectManager) {
    }


    /**
     * Called from vscode if the user hovers over a word.
     * @param document The current document.
     * @param position The position of the word.
     * @param token
     */
    public async provideHover(document: vscode.TextDocument, position: vscode.Position, _token: vscode.CancellationToken): Promise<vscode.Hover | undefined> {
        const config = Config.getConfigForDoc(document);
        if (!config.enableHovering)
            return undefined;
        const project = await this.projects.getProject(document);
        if (!project)
            return undefined;

        const include = project.includeAt(document.fileName, position.line, position.character);
        if (include)
            return new vscode.Hover(include.target ?? 'File not found.');

        const texts: vscode.MarkdownString[] = [];
        for (const {occurrence, keys} of keysAt(project, document.fileName, position)) {
            for (const key of keys) {
                // Hovering the definition itself: only if it has comments
                const defs = project.getDefinitions(key);
                for (const def of defs.slice(0, 5)) {
                    const isSelf = occurrence.isDef && def.line === occurrence.line && def.start === occurrence.start;
                    const md = this.describe(project, def, isSelf);
                    if (md)
                        texts.push(md);
                }
            }
        }
        if (texts.length === 0)
            return undefined;
        return new vscode.Hover(texts);
    }


    /** Markdown for a definition: header, comments above and the definition line. */
    protected describe(project: Project, def: SymbolDef, isSelf: boolean): vscode.MarkdownString | undefined {
        const lines = project.getLines(def.file) ?? [];
        // Comments above the definition (the line itself is shown as code)
        const copy = [...lines];
        if (def.line < copy.length)
            copy[def.line] = '';
        const comments = readCommentsForLine(copy, def.line).map(s => s.trim());
        if (isSelf && comments.length === 0 && def.kind !== 'equ' && def.kind !== 'defl')
            return undefined;

        const md = new vscode.MarkdownString();
        const where = path.basename(def.file) + ':' + (def.line + 1);
        md.appendMarkdown(`**${escape(def.derivedFrom ? def.name : keyName(def.key))}** — ${kindText(def.kind)}, ${escape(where)}\n\n`);
        if (def.derivedFrom)
            md.appendMarkdown(`${def.kind === 'field' ? 'Field of struct instance' : 'Made by a macro expansion'}, see \`${escape(keyName(def.derivedFrom))}\`\n\n`);
        if (comments.length > 0)
            md.appendMarkdown(comments.map(escape).join('  \n') + '\n\n');
        const code = lines[def.line]?.trim();
        if (code && !isSelf)
            md.appendCodeblock(code, 'sjasmplus');
        else if (code && (def.kind === 'equ' || def.kind === 'defl'))
            md.appendCodeblock(code, 'sjasmplus');
        return md;
    }
}


function escape(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-!<>|]/g, '\\$&');
}
