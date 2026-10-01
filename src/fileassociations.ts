/**
 * Finds "files.associations" entries that send the file types of this
 * extension to another language (e.g. "*.asm": "asm-collection" of ASM
 * Code Lens 2), so the files never reach this extension.
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


/**
 * @param associations The "files.associations" setting.
 * @param sourceExtensions Extensions of sjasmplus sources, e.g. [".asm", ".inc"].
 * @param listingExtensions Extensions of listings, e.g. [".lst"].
 * @param knownLanguages Ids of all installed languages.
 */
export function findConflictingAssociations(associations: {[pattern: string]: string}, sourceExtensions: string[], listingExtensions: string[], knownLanguages: string[]): ConflictingAssociation[] {
	const lower = (exts: string[]) => exts.map(e => e.toLowerCase());
	const sources = lower(sourceExtensions);
	const listings = lower(listingExtensions);
	const known = new Set(knownLanguages);
	const result: ConflictingAssociation[] = [];
	for (const [pattern, language] of Object.entries(associations)) {
		if (typeof language !== 'string' || language === 'sjasmplus' || language === 'sjasmplus-list')
			continue;
		// Only plain extension globs like "*.asm" or "**/*.asm"
		const m = /^(?:\*\*\/)?\*(\.[^*/?{}[\]]+)$/.exec(pattern);
		if (!m)
			continue;
		const ext = m[1].toLowerCase();
		const target = sources.includes(ext) ? 'sjasmplus' : listings.includes(ext) ? 'sjasmplus-list' : undefined;
		if (target)
			result.push({pattern, language, target, missing: !known.has(language)});
	}
	return result;
}
