import { App, PluginSettingTab, SettingDefinitionItem } from 'obsidian';
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

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Auto-start server',
				desc: 'Start the local server whenever this vault opens.',
				control: {
					type: 'toggle',
					key: 'autoStart',
					defaultValue: DEFAULT_SETTINGS.autoStart,
				},
			},
			{
				name: 'Preferred port',
				desc: 'The server starts here and tries later ports when it is already in use.',
				control: {
					type: 'number',
					key: 'preferredPort',
					defaultValue: DEFAULT_SETTINGS.preferredPort,
					min: 1024,
					max: 65535,
					step: 1,
				},
			},
			{
				name: 'Additional ports to try',
				desc: 'Allows multiple vaults to run simultaneously without manual port assignment.',
				control: {
					type: 'number',
					key: 'portScanRange',
					defaultValue: DEFAULT_SETTINGS.portScanRange,
					min: 0,
					max: 100,
					step: 1,
				},
			},
			{
				name: 'Bearer token',
				desc: 'Required secret generated for this vault. Select and copy it into trusted client configuration; changes apply after restart.',
				render: (setting) => {
					setting.addText((text) => {
						text
							.setPlaceholder('Required')
							.setValue(this.plugin.settings.bearerToken)
							.onChange(async (value) => {
								this.plugin.settings.bearerToken = value;
								await this.plugin.saveSettings();
							});
						text.inputEl.type = 'password';
					});
				},
			},
			{
				name: 'Server status',
				desc: this.plugin.serverDescription,
				render: (setting) => {
					setting.addButton((button) =>
						button.setButtonText('Restart').onClick(async () => {
							await this.plugin.restartServer();
							this.update();
						}),
					);
				},
			},
		];
	}
}
