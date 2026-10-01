import * as vscode from 'vscode';
import {Config} from './config';
import {PackageInfo} from './packageinfo';
import {FormatOptions, formatText} from './sjasm/formatter';



/**
 * Formatting of sjasmplus sources ("Format Document", "Format Selection").
 */
export class FormattingProvider implements vscode.DocumentFormattingEditProvider, vscode.DocumentRangeFormattingEditProvider {

    public provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions, _token: vscode.CancellationToken): vscode.TextEdit[] | undefined {
        return this.format(document, options, 0, document.lineCount - 1);
    }


    public provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range, options: vscode.FormattingOptions, _token: vscode.CancellationToken): vscode.TextEdit[] | undefined {
        return this.format(document, options, range.start.line, range.end.line);
    }


    protected format(document: vscode.TextDocument, options: vscode.FormattingOptions, fromLine: number, toLine: number): vscode.TextEdit[] | undefined {
        const config = Config.getConfigForDoc(document);
        if (!config.enableFormatting)
            return undefined;
        const settings = PackageInfo.getConfiguration(vscode.workspace.getWorkspaceFolder(document.uri));
        const formatOptions: FormatOptions = {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
            indentation: settings.get('format.indentation'),
            instructionColumn: settings.get('format.instructionColumn'),
            directiveColumn: settings.get('format.directiveColumn'),
            case: settings.get('format.case'),
            commaSpace: settings.get('format.commaSpace'),
            operandSpacing: settings.get('format.operandSpacing'),
            trailingComments: settings.get('format.trailingComments'),
            commentColumn: settings.get('format.commentColumn'),
            dirbol: settings.get('dirbol')
        };
        return formatText(document.getText(), formatOptions, fromLine, toLine).map(edit =>
            vscode.TextEdit.replace(document.lineAt(edit.line).range, edit.text));
    }
}
