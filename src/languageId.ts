import {strict as assert} from 'assert';
import * as vscode from 'vscode';
import {FuncCache} from './funccache';
import {PackageInfo} from './packageinfo';
import {Associations, associationFor, globExtensions} from './fileassociations';

/**
 * The known language IDs.
 */
export type AllowedLanguageIds = 'sjasmplus' | 'sjasmplus-list';


/**
 * Class the encapsulates the caching of the language information.
 */

export class LanguageId {

	protected static asmCollectionCache = new FuncCache<string>(10000, () => {
		return LanguageId._getGlobalIncludeForLanguageId('sjasmplus');
	});

	protected static asmFileListCache = new FuncCache<string>(10000, () => {
		return LanguageId._getGlobalIncludeForLanguageId('sjasmplus-list');
	});


	/**
	 * The function wraps _getGlobalIncludeForLanguageId to cache it for a little time.
	 * E.g. for 10 secs.
	 * As the function is called quite often, this increases the overall performance.
	 * @parameter languageId Either "sjasmplus" or "sjasmplus-list".
	 * @returns  E.g. "** /*.{asm, inc, s}"
	 */
	public static getGlobalIncludeForLanguageId(languageId: AllowedLanguageIds): string {
		if (languageId == 'sjasmplus')
			return LanguageId.asmCollectionCache.getData();
		if (languageId == 'sjasmplus-list')
			return LanguageId.asmFileListCache.getData();
		// Should not reach here
		assert(false, 'languageId = "' + languageId + '" unknown.');
	}

	/**
	 * The function returns the glob for a given language ID.
	 * It takes the list for associated files from package.json.
	 * Then it adds files from "files.associations" added by the user and
	 * it removes files that the user assigned otherwise.
	 * The remaining list is returned as glob.
	 * @parameter languageId Either "sjasmplus" or "sjasmplus-list".
	 * @returns  E.g. "** /*.{asm, inc, s}"
	 */
	protected static _getGlobalIncludeForLanguageId(languageId: AllowedLanguageIds): string {
		// Package json: the extensions defined for the language
		const languages: {id: string, extensions?: string[]}[] = PackageInfo.extension.packageJSON.contributes.languages;
		const own = (languages.find(lang => lang.id === languageId)?.extensions ?? []).map(ext => ext.toLowerCase());

		// User's file associations decide where they say something (the longest glob wins)
		const associations = vscode.workspace.getConfiguration('files').get<Associations>('associations') ?? {};
		const candidates = new Set(own);
		for (const pattern of Object.keys(associations))
			for (const ext of globExtensions(pattern) ?? [])
				candidates.add(ext);
		const exts = [...candidates].filter(ext => {
			const association = associationFor(associations, ext);
			return association ? association.language === languageId : own.includes(ext);
		});

		// Create glob string
		const glob = '**/*.{' + exts.map(ext => ext.substring(1)).join(',') + '}';
		return glob;    // E.g. "**/*.{asm,inc,s}"
	}
}
