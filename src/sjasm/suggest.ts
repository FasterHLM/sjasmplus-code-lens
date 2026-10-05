/**
 * The number of one-character changes that turn a into b: a substitution, an insertion, a
 * deletion, or a swap of two neighbours (the usual typos).
 */
export function editDistance(a: string, b: string): number {
	const rows: number[][] = [];
	for (let i = 0; i <= a.length; i++) {
		rows.push(new Array<number>(b.length + 1).fill(0));
		rows[i][0] = i;
	}
	for (let j = 0; j <= b.length; j++)
		rows[0][j] = j;
	for (let i = 1; i <= a.length; i++) {
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
		}
	}
	return rows[a.length][b.length];
}


/**
 * How many changes a name of this length may differ by to be taken for a typo of another:
 * none for a short name (too many names are alike), one for four or five characters, else two.
 */
export function maxTypos(length: number): number {
	return length <= 3 ? 0 : length <= 5 ? 1 : 2;
}
