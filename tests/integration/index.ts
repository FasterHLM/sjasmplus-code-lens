/**
 * Entry point inside the VS Code extension host: runs the integration tests with mocha.
 */
import * as path from 'path';
import Mocha = require('mocha');


export function run(): Promise<void> {
	const mocha = new Mocha({ui: 'tdd', timeout: 60000, color: true});
	mocha.addFile(path.resolve(__dirname, 'providers.itest.js'));
	return new Promise((resolve, reject) => {
		mocha.run(failures => failures > 0 ? reject(new Error(`${failures} integration tests failed.`)) : resolve());
	});
}
