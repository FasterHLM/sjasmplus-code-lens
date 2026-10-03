/**
 * The symbol kinds that get a code lens (the number of references above them),
 * by the group names the setting codeLensKinds uses.
 */
export const LENS_KIND_GROUPS: {[group: string]: string[]} = {
	labels: ['label', 'data'],
	constants: ['equ', 'defl'],
	structs: ['struct', 'field'],
	macros: ['macro'],
	defines: ['define']
};


/**
 * The symbol kinds that get a code lens for the value of the setting codeLensKinds:
 * the kinds of the groups in the list. All kinds if the value is not a list;
 * names that are not groups are ignored.
 */
export function lensKinds(groups: unknown): Set<string> {
	const names: unknown[] = Array.isArray(groups) ? groups : Object.keys(LENS_KIND_GROUPS);
	const kinds = new Set<string>();
	for (const name of names) {
		if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(LENS_KIND_GROUPS, name))
			LENS_KIND_GROUPS[name].forEach(kind => kinds.add(kind));
	}
	return kinds;
}
