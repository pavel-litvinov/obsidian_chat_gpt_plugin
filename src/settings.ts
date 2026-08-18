import { App, PluginSettingTab, Setting } from 'obsidian';
import type VaultToolkitBridgePlugin from './main';

export interface VaultToolkitSettings {
	preferredPort: number;
	portScanRange: number;
	autoStart: boolean;
	bearerToken: string;
}

export const DEFAULT_SETTINGS: VaultToolkitSettings = {
	preferredPort: 8766,
	portScanRange: 20,
	autoStart: true,
	bearerToken: '',
};

export class VaultToolkitSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: VaultToolkitBridgePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		this.containerEl.empty();

		new Setting(this.containerEl)
			.setName('Auto-start server')
			.setDesc('Start the local server whenever this vault opens.')
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.autoStart).onChange(async (value) => {
					this.plugin.settings.autoStart = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(this.containerEl)
			.setName('Preferred port')
			.setDesc('The server starts here and tries later ports when it is already in use.')
			.addText((text) =>
				text
					.setPlaceholder('8766')
					.setValue(String(this.plugin.settings.preferredPort))
					.onChange(async (value) => {
						const port = Number.parseInt(value, 10);
						if (Number.isInteger(port) && port >= 1024 && port <= 65535) {
							this.plugin.settings.preferredPort = port;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(this.containerEl)
			.setName('Additional ports to try')
			.setDesc('Allows multiple vaults to run simultaneously without manual port assignment.')
			.addText((text) =>
				text
					.setPlaceholder('20')
					.setValue(String(this.plugin.settings.portScanRange))
					.onChange(async (value) => {
						const range = Number.parseInt(value, 10);
						if (Number.isInteger(range) && range >= 0 && range <= 100) {
							this.plugin.settings.portScanRange = range;
							await this.plugin.saveSettings();
						}
					}),
			);

		new Setting(this.containerEl)
			.setName('Bearer token')
			.setDesc('Optional shared secret. The server always listens on localhost only.')
			.addText((text) => {
				text
					.setPlaceholder('Optional')
					.setValue(this.plugin.settings.bearerToken)
					.onChange(async (value) => {
						this.plugin.settings.bearerToken = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.type = 'password';
			});

		new Setting(this.containerEl)
			.setName('Server status')
			.setDesc(this.plugin.serverDescription)
			.addButton((button) =>
				button.setButtonText('Restart').onClick(async () => {
					await this.plugin.restartServer();
					this.display();
				}),
			);
	}
}
