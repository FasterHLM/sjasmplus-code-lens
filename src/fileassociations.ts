/**
 * Finds what sends the file types of this extension to another language,
 * so the files never reach this extension:
 * - "files.associations" entries (e.g. "*.asm": "asm-collection" of ASM Code Lens 2),
 * - other extensions that contribute a language for the same file types
 *   (e.g. DeZog, Z80 Macro-Assembler): of two extensions VS Code takes the
 *   one registered last, which depends on the extension ids.
 */


export interface ConflictingAssociation {
	/** The glob, e.g. "*.asm". */
	pattern: string;
	/** The language it is associated with now. */
	language: string;
	/** The language it should be associated with: "sjasmplus" or "sjasmplus-list". */
	target: string;
	/** True if the language is not installed (the files open as plain text). */
	missing: boolean;
}


/** A language contributed by an extension ("contributes.languages"). */
export interface ContributedLanguage {
	/** E.g. "mborik.z80-macroasm". */
	extensionId: string;
	/** E.g. "Z80 Macro-Assembler". */
	extensionName: string;
	/** E.g. "z80-macroasm". */
	language: string;
	/** File extensions, e.g. [".a80", ".asm", ".inc", ".s"]. */
	extensions: string[];
}


/** A file type of this extension that another extension also contributes a language for. */
export interface CompetingLanguage extends ContributedLanguage {
	/** Our file extension, lower case, e.g. ".asm". */
	extension: string;
	/** The glob to associate, e.g. "*.asm". */
	pattern: string;
	/** "sjasmplus" or "sjasmplus-list". */
	target: string;
}


/** The extension of a plain extension glob like "*.asm" or "**\/*.asm" (lower case), else undefined. */
function globExtension(pattern: string): string | undefined {
	const m = /^(?:\*\*\/)?\*(\.[^*/?{}[\]]+)$/.exec(pattern);
	return m?.[1].toLowerCase();
}


/** "sjasmplus", "sjasmplus-list" or undefined for an extension like ".asm". */
function targetOf(ext: string, sourceExtensions: string[], listingExtensions: string[]): string | undefined {
	const lower = ext.toLowerCase();
	if (sourceExtensions.some(e => e.toLowerCase() === lower))
		return 'sjasmplus';
	if (listingExtensions.some(e => e.toLowerCase() === lower))
		return 'sjasmplus-list';
	return undefined;
}


/**
 * @param associations The "files.associations" setting.
 * @param sourceExtensions Extensions of sjasmplus sources, e.g. [".asm", ".inc"].
 * @param listingExtensions Extensions of listings, e.g. [".lst"].
 * @param knownLanguages Ids of all installed languages.
 */
export function findConflictingAssociations(associations: {[pattern: string]: string}, sourceExtensions: string[], listingExtensions: string[], knownLanguages: string[]): ConflictingAssociation[] {
	const known = new Set(knownLanguages);
	const result: ConflictingAssociation[] = [];
	for (const [pattern, language] of Object.entries(associations)) {
		if (typeof language !== 'string' || language === 'sjasmplus' || language === 'sjasmplus-list')
			continue;
		// Only plain extension globs like "*.asm" or "**/*.asm"
		const ext = globExtension(pattern);
		const target = ext && targetOf(ext, sourceExtensions, listingExtensions);
		if (target)
			result.push({pattern, language, target, missing: !known.has(language)});
	}
	return result;
}


/**
 * The languages of other extensions for our file types that
 * "files.associations" does not decide (in either direction).
 * @param languages The languages of all other (enabled) extensions.
 * @param associations The "files.associations" setting.
 */
export function findCompetingLanguages(languages: ContributedLanguage[], associations: {[pattern: string]: string}, sourceExtensions: string[], listingExtensions: string[]): CompetingLanguage[] {
	const associated = new Set<string>();
	for (const pattern of Object.keys(associations)) {
		const ext = globExtension(pattern);
		if (ext)
			associated.add(ext);
	}
	const result: CompetingLanguage[] = [];
	for (const lang of languages) {
		for (const e of lang.extensions) {
			const extension = e.toLowerCase();
			const target = targetOf(extension, sourceExtensions, listingExtensions);
			if (target && !associated.has(extension) && !result.some(r => r.language === lang.language && r.extension === extension))
				result.push({...lang, extension, pattern: '*' + extension, target});
		}
	}
	return result;
}
