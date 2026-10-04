import * as vscode from 'vscode';
import {Config} from './config';
import {getFoldingRanges} from './sjasm/folding';



/** The folding Provider.
 * Only for asm files not for list files.
 */
export class FoldingProvider implements vscode.FoldingRangeProvider {

	/** Returns a list of folding ranges:
	 * - blocks (MODULE, STRUCT, MACRO, DUP, IF..., LUA),
	 * - labels up to the next label,
	 * - comment blocks.
	 * @param document The document in which the command was invoked.
	 * @param context Additional context information (for future use)
	 * @param token A cancellation token.
	 */
	provideFoldingRanges(document: vscode.TextDocument, _context: vscode.FoldingContext, _token: vscode.CancellationToken): vscode.ProviderResult<vscode.FoldingRange[]> {
		const config = Config.getConfigForDoc(document);
		if (!config.enableFolding)
			return [];

		return getFoldingRanges(document.getText()).map(r => new vscode.FoldingRange(r.start, r.end,
			r.kind === 'region' ? vscode.FoldingRangeKind.Region : (r.kind === 'comment' ? vscode.FoldingRangeKind.Comment : undefined)));
	}
}
