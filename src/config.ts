import * as vscode from 'vscode';
import {PackageInfo} from './packageinfo';


 /**
  * Used to pass user preferences settings between functions.
  * All configurations and all workspace folder are stored in 'configs'.
  * Each workspace folder can have own settings.
  *
  * However, there is only one provider registered at vscode for all workspaces.
  * This seems not fully implemented in vscode:
  * E.g. if folder A registers the goto definitions and the folder B doesn't,
  * then a definition provider has to be registered. I.e. a menu "Goto definition"
  * is also displayed in folder B.
  *
  * If a provider should be enabled is found in the 'enable...' instance variables.
  * All are ORed in the 'globalEnable...' static variables.
  * Via the global variables a provider is registered. I.e. if the 'GlobalEnable...'
  * is false the provider will not be registered at all.
  */
export class Config {
	// true if code lenses should be enabled.
	public static globalEnableCodeLenses: boolean;

	// true if hovering should be enabled.
	public static globalEnableHovering: boolean;

	// true if completions should be enabled.
	public static globalEnableCompletions: boolean;

	// true if goto definition should be enabled.
	public static globalEnableGotoDefinition: boolean;

	// true if find all references should be enabled.
	public static globalEnableFindAllReferences: boolean;

	// true if renaming should be enabled.
	public static globalEnableRenaming: boolean;

	// true if the outline view should be enabled.
	public static globalEnableOutlineView: boolean;

	// true if workspace symbols should be enabled
	public static globalEnableWorkspaceSymbols: boolean;

	// The custom prefix to use for toggle line comment. Depends on language
	// id and can therefore only be set globally.
	public static globalToggleCommentPrefix: string;

	// Highlighting of matching push/pops
	public static globalEnablePushPopMatching: boolean;

	// A map with the configs for all workspace folders
	public static configs = new Map<string, Config>();

	// The config for documents outside of any workspace folder
	public static defaultConfig: Config;


	// The root folder of the workspace ('' for documents outside of workspace folders)
	public wsFolderPath: string;

	// true if code lenses should be enabled.
	public enableCodeLenses: boolean;

	// true if hovering should be enabled.
	public enableHovering: boolean;

	// true if completions should be enabled.
	public enableCompletions: boolean;

	// true if goto definition should be enabled.
	public enableGotoDefinition: boolean;

	// true if find all references should be enabled.
	public enableFindAllReferences: boolean;

	// true if renaming should be enabled.
	public enableRenaming: boolean;

	// true if the outline view should be enabled.
	public enableOutlineView: boolean;

	// true if workspace symbols are enabled
	public enableWorkspaceSymbols: boolean;

	// true if folding is enabled
	public enableFolding: boolean;

	// true if formatting is enabled
	public enableFormatting: boolean;

	// Required minimum length for completions.
	public completionsRequiredLength: number;

	// Required minimum length for workspace symbols.
	public workspaceSymbolsRequiredLength: number;


	/** Loops through all workspace folders and gets their configuration.
	 */
	public static init() {
		// Set global variables (variables with 'window' scope)
		const globalSettings = PackageInfo.getConfiguration();
		Config.globalToggleCommentPrefix = globalSettings.comments.toggleLineCommentPrefix;
		Config.globalEnablePushPopMatching = globalSettings.enablePushPopMatching;

		// Clear global/local variables (variables with 'resource' scope)
		Config.globalEnableCodeLenses = false;
		Config.globalEnableHovering = false;
		Config.globalEnableCompletions = false;
		Config.globalEnableGotoDefinition = false;
		Config.globalEnableFindAllReferences = false;
		Config.globalEnableRenaming = false;
		Config.globalEnableOutlineView = false;
		Config.globalEnableWorkspaceSymbols = false;

		// Go through each setting, plus the settings for files outside of workspace folders
		Config.configs.clear();
		const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
		Config.defaultConfig = Config.create('', PackageInfo.getConfiguration());
		const all = [Config.defaultConfig];
		for (const workspaceFolder of workspaceFolders) {
			const fsPath = workspaceFolder.uri.fsPath;
			const config = Config.create(fsPath, PackageInfo.getConfiguration(workspaceFolder));
			Config.configs.set(fsPath, config);
			all.push(config);
		}
		for (const config of all) {
			Config.globalEnableCodeLenses ||= config.enableCodeLenses;
			Config.globalEnableHovering ||= config.enableHovering;
			Config.globalEnableCompletions ||= config.enableCompletions;
			Config.globalEnableGotoDefinition ||= config.enableGotoDefinition;
			Config.globalEnableFindAllReferences ||= config.enableFindAllReferences;
			Config.globalEnableRenaming ||= config.enableRenaming;
			Config.globalEnableOutlineView ||= config.enableOutlineView;
			Config.globalEnableWorkspaceSymbols ||= config.enableWorkspaceSymbols;
		}
	}


	protected static create(fsPath: string, settings: vscode.WorkspaceConfiguration): Config {
		const config = new Config();
		config.wsFolderPath = fsPath;
		config.enableCodeLenses = settings.enableCodeLenses;
		config.enableHovering = settings.enableHovering;
		config.enableCompletions = settings.enableCompletions;
		config.enableGotoDefinition = settings.enableGotoDefinition;
		config.enableFindAllReferences = settings.enableFindAllReferences;
		config.enableRenaming = settings.enableRenaming;
		config.enableOutlineView = settings.enableOutlineView;
		config.enableWorkspaceSymbols = settings.enableWorkspaceSymbols;
		config.enableFolding = settings.enableFolding;
		config.enableFormatting = settings.enableFormatting;
		config.completionsRequiredLength = Math.max(1, settings.completionsRequiredLength || 0);
		config.workspaceSymbolsRequiredLength = Math.max(1, settings.workspaceSymbolsRequiredLength || 0);
		return config;
	}


	/** Returns the config for a text document: the one of its workspace folder
	 * or the default config for documents outside of workspace folders.
	 * @param document The TextDocument.
	 */
	public static getConfigForDoc(document: vscode.TextDocument): Config {
		const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (workspaceFolder)
			return Config.configs.get(workspaceFolder.uri.fsPath) ?? Config.defaultConfig;
		return Config.defaultConfig;
	}
}
