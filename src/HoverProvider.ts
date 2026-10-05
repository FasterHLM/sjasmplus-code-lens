import * as vscode from 'vscode';
import * as path from 'path';
import {Config} from './config';
import {readCommentsForLine} from './comments';
import {PackageInfo} from './packageinfo';
import {ProjectManager, SOURCE_LANGUAGE} from './projectmanager';
import {keyName, keysAt, kindText} from './symbols';
import {parseText} from './sjasm/parser';
import {Project, SymbolDef} from './sjasm/project';
import {describeValue, numberAt} from './sjasm/values';


/**
 * HoverProvider for assembly language.
 * Shows the definition line, the comments above it and the full name; for a constant
 * (EQU, DEFL) its value, and for a number that is not a symbol its forms.
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

        const hexPrefix = PackageInfo.getConfiguration(vscode.workspace.getWorkspaceFolder(document.uri)).get<string>('hexCalculator.hexPrefix') || '0x';
        const texts: vscode.MarkdownString[] = [];
        for (const {occurrence, keys} of keysAt(project, document.fileName, position)) {
            for (const key of keys) {
                // Hovering the definition itself: only if it has comments
                const defs = project.getDefinitions(key);
                for (const def of defs.slice(0, 5)) {
                    const isSelf = occurrence.isDef && def.line === occurrence.line && def.start === occurrence.start;
                    const md = this.describe(project, def, isSelf, hexPrefix);
                    if (md)
                        texts.push(md);
                }
            }
        }
        if (texts.length === 0)
            return this.hoverNumber(document, position, hexPrefix);
        return new vscode.Hover(texts);
    }


    /** The forms of the number under the cursor (decimal, hex, binary), if it is not a symbol. */
    protected hoverNumber(document: vscode.TextDocument, position: vscode.Position, hexPrefix: string): vscode.Hover | undefined {
        // A listing has addresses and bytes in it, a block comment and a Lua block are not code
        if (document.languageId !== SOURCE_LANGUAGE)
            return undefined;
        const line = parseText(document.getText()).parsed[position.line];
        if (!line || line.inBlockComment || line.lua)
            return undefined;
        const found = numberAt(document.lineAt(position.line).text, position.character);
        if (!found)
            return undefined;
        const md = new vscode.MarkdownString();
        md.appendMarkdown('`' + describeValue(found.value, hexPrefix) + '`');
        return new vscode.Hover(md, new vscode.Range(position.line, found.start, position.line, found.end));
    }


    /** Markdown for a definition: header, the value of a constant, comments above and the definition line. */
    protected describe(project: Project, def: SymbolDef, isSelf: boolean, hexPrefix: string): vscode.MarkdownString | undefined {
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
        const value = project.getConstantValue(def);
        if (value !== undefined)
            md.appendMarkdown('`= ' + describeValue(value, hexPrefix) + '`\n\n');
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
