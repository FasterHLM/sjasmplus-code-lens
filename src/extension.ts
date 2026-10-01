import * as vscode from 'vscode';
import {ReferenceProvider} from './ReferenceProvider';
import {DefinitionProvider} from './DefinitionProvider';
import {HoverProvider} from './HoverProvider';
import {CodeLensProvider} from './CodeLensProvider';
import {RenameProvider} from './RenameProvider';
import {DocumentSymbolProvider} from './DocumentSymbolProvider';
import {CompletionProposalsProvider} from './CompletionProposalsProvider';
import {Commands} from './Commands';
import {setCustomCommentPrefix} from './comments';
import {HexCalcProvider} from './HexCalcProvider';
import {PackageInfo} from './packageinfo';
import {Config} from './config';
import {WorkspaceSymbolProvider} from './WorkspaceSymbolProvider';
import {FoldingProvider} from './FoldingRangeProvider';
import {FormattingProvider} from './FormattingProvider';
import {DiagnosticsProvider} from './DiagnosticsProvider';
import {SEMANTIC_LEGEND, SemanticTokensProvider} from './SemanticTokensProvider';
import {LISTING_LANGUAGE, ProjectManager, SOURCE_LANGUAGE} from './projectmanager';



export function activate(context: vscode.ExtensionContext) {

    // Init package info
    PackageInfo.Init(context);

    // The symbol index of all sjasmplus projects
    projects = new ProjectManager();
    context.subscriptions.push(projects);

    // Unresolved labels and dimmed inactive blocks
    context.subscriptions.push(new DiagnosticsProvider(projects));

    // Semantic highlighting (checks the setting itself)
    context.subscriptions.push(vscode.languages.registerDocumentSemanticTokensProvider(
        [{scheme: "file", language: SOURCE_LANGUAGE}, {scheme: "file", language: LISTING_LANGUAGE}],
        new SemanticTokensProvider(projects), SEMANTIC_LEGEND));

    // Register the hex calculator webviews
    hexCalcExplorerProvider = new HexCalcProvider();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sjasmplus-code-lens.calcview-explorer", hexCalcExplorerProvider, {webviewOptions: {retainContextWhenHidden: true}})
    );
    hexCalcDebugProvider = new HexCalcProvider();
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider("sjasmplus-code-lens.calcview-debug", hexCalcDebugProvider, {webviewOptions: {retainContextWhenHidden: true}})
    );

    // Enable logging.
    configure(context);

    // Check for every change.
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
        configure(context, event);
    }));

    // Check for added/removed workspace folders.
    context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(event => {
        // Simply removes and re-inits all workspace folders.
        configure(context);
        // Note: in my tests together with this event a 'onDidChangeConfiguration' was sent.
        // But because I'm not sure if that would always be the case I also
        // check for the 'onDidChangeWorkspaceFolders' event.
    }));

    // Register commands.
    context.subscriptions.push(vscode.commands.registerCommand('sjasmplus-code-lens.find-labels-with-no-reference', async () => {
        // Get current text editor to get current project/root folder.
        const doc = vscode.window.activeTextEditor?.document;
        if (doc?.languageId !== SOURCE_LANGUAGE && doc?.languageId !== LISTING_LANGUAGE)
            return;
        await Commands.findLabelsWithNoReference(projects, doc);
    }));
}


/**
 * Reads the configuration.
 */
function configure(context: vscode.ExtensionContext, event?: vscode.ConfigurationChangeEvent) {
    // Note: configuration preferences scopes
    // - "window": user, workspace or remote.
    // - "resource": user, workspace, folder or remote.
    // - "application": user only.
    // So in multiroot different workspaces have different settings.

    // Check for the hex calculator params
    if (event) {
        if (event.affectsConfiguration('sjasmplus-code-lens.hexCalculator.hexPrefix')) {
            // Update the hex calculators
            if (hexCalcExplorerProvider)
                hexCalcExplorerProvider.setMainHtml();
            if (hexCalcDebugProvider)
                hexCalcDebugProvider.setMainHtml();
        }
        // Re-registering the providers would drop requests in flight, only do it for own settings
        if (!event.affectsConfiguration(PackageInfo.extension.packageJSON.name))
            return;
    }

    // Dispose (remove, deregister) all providers
    removeProvider(regCodeLensProvider, context);
    removeProvider(regHoverProvider, context);
    removeProvider(regCompletionProposalsProvider, context);
    removeProvider(regDefinitionProvider, context);
    removeProvider(regReferenceProvider, context);
    removeProvider(regRenameProvider, context);
    removeProvider(regDocumentSymbolProvider, context);
    removeProvider(regWorkspaceSymbolProvider, context);
    removeProvider(regFoldingProvider, context);
    removeProvider(regFormattingProvider, context);
    removeProvider(regRangeFormattingProvider, context);

    // Re-read settings for all workspaces.
    Config.init();

    // Both "languages": asm files and list files.
    const asmListFiles: vscode.DocumentSelector = [
        {scheme: "file", language: SOURCE_LANGUAGE},
        {scheme: "file", language: LISTING_LANGUAGE}
    ];

    // Multiroot: One provider for all workspace folders:

    // Register
    if (Config.globalEnableCodeLenses) {
        const codeLensProvider = new CodeLensProvider(projects);
        regCodeLensProvider = vscode.languages.registerCodeLensProvider(asmListFiles, codeLensProvider);
        context.subscriptions.push(regCodeLensProvider);
    }

    // Register
    if (Config.globalEnableHovering) {
        regHoverProvider = vscode.languages.registerHoverProvider(asmListFiles, new HoverProvider(projects));
        context.subscriptions.push(regHoverProvider);
    }

    // Register
    if (Config.globalEnableCompletions) {
        regCompletionProposalsProvider = vscode.languages.registerCompletionItemProvider(asmListFiles, new CompletionProposalsProvider(projects), '.');
        context.subscriptions.push(regCompletionProposalsProvider);
    }

    // Register
    if (Config.globalEnableGotoDefinition) {
        regDefinitionProvider = vscode.languages.registerDefinitionProvider(asmListFiles, new DefinitionProvider(projects));
        context.subscriptions.push(regDefinitionProvider);
    }

    // Register
    if (Config.globalEnableFindAllReferences) {
        regReferenceProvider = vscode.languages.registerReferenceProvider(asmListFiles, new ReferenceProvider(projects));
        context.subscriptions.push(regReferenceProvider);
    }

    // Register
    if (Config.globalEnableRenaming) {
        regRenameProvider = vscode.languages.registerRenameProvider(asmListFiles, new RenameProvider(projects));
        context.subscriptions.push(regRenameProvider);
    }

    // Register
    if (Config.globalEnableOutlineView) {
        regDocumentSymbolProvider = vscode.languages.registerDocumentSymbolProvider(asmListFiles, new DocumentSymbolProvider(projects));
        context.subscriptions.push(regDocumentSymbolProvider);
    }

    // Register
    if (Config.globalEnableWorkspaceSymbols) {
        regWorkspaceSymbolProvider = vscode.languages.registerWorkspaceSymbolProvider(new WorkspaceSymbolProvider(projects));
        context.subscriptions.push(regWorkspaceSymbolProvider);
    }

    // Register (always, even if disabled)
    regFoldingProvider = vscode.languages.registerFoldingRangeProvider({scheme: "file", language: SOURCE_LANGUAGE}, new FoldingProvider());
    context.subscriptions.push(regFoldingProvider);

    // Register (always, checks the setting itself)
    const formattingProvider = new FormattingProvider();
    regFormattingProvider = vscode.languages.registerDocumentFormattingEditProvider({scheme: "file", language: SOURCE_LANGUAGE}, formattingProvider);
    regRangeFormattingProvider = vscode.languages.registerDocumentRangeFormattingEditProvider({scheme: "file", language: SOURCE_LANGUAGE}, formattingProvider);
    context.subscriptions.push(regFormattingProvider, regRangeFormattingProvider);

    // Toggle line Comment configuration
    vscode.languages.setLanguageConfiguration(SOURCE_LANGUAGE, {comments: {lineComment: Config.globalToggleCommentPrefix, blockComment: ["/*", "*/"]}});
    // Store
    setCustomCommentPrefix(Config.globalToggleCommentPrefix);

    // Toggle push/pop highlighting
    const brackets: vscode.CharacterPair[] = [
        ["{", "}"],
        ["[", "]"],
        ["(", ")"]
    ];
    if (Config.globalEnablePushPopMatching)
        brackets.push(["push", "pop"]);
    vscode.languages.setLanguageConfiguration(SOURCE_LANGUAGE, {brackets});
}


/**
 * Removes a provider.
 * Disposes it and removes it from subscription list.
 */
function removeProvider(pv: vscode.Disposable|undefined, context: vscode.ExtensionContext) {
    if (pv) {
        pv.dispose();
        const i = context.subscriptions.indexOf(pv);
        if (i >= 0)
            context.subscriptions.splice(i, 1);
    }
}


let projects: ProjectManager;
let hexCalcExplorerProvider;
let hexCalcDebugProvider;
let regCodeLensProvider: vscode.Disposable;
let regHoverProvider: vscode.Disposable;
let regCompletionProposalsProvider: vscode.Disposable;
let regDefinitionProvider: vscode.Disposable;
let regReferenceProvider: vscode.Disposable;
let regRenameProvider: vscode.Disposable;
let regDocumentSymbolProvider: vscode.Disposable;
let regWorkspaceSymbolProvider: vscode.Disposable;
let regFoldingProvider: vscode.Disposable;
let regFormattingProvider: vscode.Disposable;
let regRangeFormattingProvider: vscode.Disposable;


// this method is called when your extension is deactivated
/*
export function deactivate() {
}
*/
