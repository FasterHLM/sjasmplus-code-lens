import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';


const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'));


suite('package.json', () => {
	test('the menus use only declared commands and submenus', () => {
		const commands = new Set(manifest.contributes.commands.map((c: {command: string}) => c.command));
		const submenus = new Set(manifest.contributes.submenus.map((s: {id: string}) => s.id));
		for (const [menu, items] of Object.entries(manifest.contributes.menus) as [string, {command?: string, submenu?: string}[]][]) {
			for (const item of items) {
				if (item.command)
					assert.ok(commands.has(item.command), `${menu}: ${item.command} is not declared`);
				if (item.submenu)
					assert.ok(submenus.has(item.submenu), `${menu}: submenu ${item.submenu} is not declared`);
			}
		}
	});

	test('the DeZog context menu commands are not in the command palette', () => {
		const hidden = new Set(manifest.contributes.menus.commandPalette.filter((i: {when: string}) => i.when === 'false').map((i: {command: string}) => i.command));
		const dezog = manifest.contributes.commands.map((c: {command: string}) => c.command).filter((c: string) => c.includes('.dezog.'));
		assert.equal(dezog.length, 7);
		for (const command of dezog)
			assert.ok(hidden.has(command), command);
	});
});
