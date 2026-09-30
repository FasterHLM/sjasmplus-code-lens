/**
 * Runs the integration tests in a downloaded VS Code instance.
 * Usage: npm run test:integration (builds the extension first).
 */
import * as path from 'path';
import {runTests} from '@vscode/test-electron';


async function main() {
	// Set when started from a VS Code terminal: would start the downloaded VS Code as plain node
	delete process.env.ELECTRON_RUN_AS_NODE;
	// out/tests/integration -> repository root
	const root = path.resolve(__dirname, '../../..');
	try {
		await runTests({
			extensionDevelopmentPath: root,
			extensionTestsPath: path.resolve(__dirname, 'index'),
			launchArgs: [path.join(root, 'tests/integration/fixture'), '--disable-extensions']
		});
	}
	catch (e) {
		console.error(e);
		process.exit(1);
	}
}

main();
