import { Notice, Plugin, TFile } from 'obsidian';
import { VaultToolkitApi } from './api';
import {
	AppendTextModal,
	CreateNoteModal,
	errorMessage,
	FrontmatterModal,
	NoteSearchModal,
	TextViewerModal,
} from './modals';
import { VaultMcpServer } from './server';
import {
	DEFAULT_SETTINGS,
	VaultToolkitSettings,
	VaultToolkitSettingTab,
} from './settings';

export default class VaultToolkitBridgePlugin extends Plugin {
	/** API available to other plugins through Obsidian's plugin registry. */
	api!: VaultToolkitApi;
	settings!: VaultToolkitSettings;
	private mcpServer!: VaultMcpServer;

	get serverDescription(): string {
		return this.mcpServer.isRunning && this.mcpServer.actualPort !== null
			? `Running for “${this.app.vault.getName()}” at http://127.0.0.1:${this.mcpServer.actualPort}/mcp`
			: 'Stopped';
	}

	async onload(): Promise<void> {
		await this.loadSettings();
		this.api = new VaultToolkitApi(this.app);
		this.mcpServer = new VaultMcpServer(this.app, this.api, this.manifest.version);
		this.addSettingTab(new VaultToolkitSettingTab(this.app, this));
		this.registerCommands();

		this.app.workspace.onLayoutReady(() => {
			if (this.settings.autoStart) {
				this.run(() => this.startServer(false));
			}
		});
	}

	onunload(): void {
		void this.mcpServer.stop();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async restartServer(): Promise<void> {
		await this.mcpServer.stop();
		await this.startServer();
	}

	private registerCommands(): void {
		this.addCommand({
			id: 'start-mcp-server',
			name: 'Start server',
			callback: () => this.run(() => this.startServer()),
		});

		this.addCommand({
			id: 'stop-mcp-server',
			name: 'Stop server',
			callback: () =>
				this.run(async () => {
					await this.mcpServer.stop();
					new Notice(`MCP server stopped for ${this.app.vault.getName()}.`);
				}),
		});

		this.addCommand({
			id: 'restart-mcp-server',
			name: 'Restart server',
			callback: () => this.run(() => this.restartServer()),
		});

		this.addCommand({
			id: 'create-note',
			name: 'Create note',
			callback: () => {
				new CreateNoteModal(this.app, async ({ path, content, tags }) => {
					const frontmatter = tags.length > 0 ? { tags } : undefined;
					const file = await this.api.createNote({ path, content, frontmatter });
					await this.app.workspace.getLeaf(true).openFile(file);
					new Notice(`Created ${file.path}.`);
				}).open();
			},
		});

		this.addCommand({
			id: 'search-notes',
			name: 'Search notes',
			callback: () => new NoteSearchModal(this.app, this.api.searchNotes('')).open(),
		});

		this.addCommand({
			id: 'show-active-note',
			name: 'Show active note contents',
			checkCallback: (checking) =>
				this.runWithActiveFile(checking, (file) => {
					this.run(async () => {
						const content = await this.api.readNote(file.path);
						new TextViewerModal(this.app, file.path, content).open();
					});
				}),
		});

		this.addCommand({
			id: 'append-active-note',
			name: 'Append text to active note',
			checkCallback: (checking) =>
				this.runWithActiveFile(checking, (file) => {
					new AppendTextModal(this.app, async (text) => {
						await this.api.updateNote(file.path, (current) => {
							const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
							return `${current}${separator}${text}\n`;
						});
						new Notice(`Updated ${file.path}.`);
					}).open();
				}),
		});

		this.addCommand({
			id: 'inspect-active-note-metadata',
			name: 'Inspect active note metadata',
			checkCallback: (checking) =>
				this.runWithActiveFile(checking, (file) => {
					const metadata = this.api.getNoteMetadata(file);
					new TextViewerModal(
						this.app,
						`Metadata: ${file.path}`,
						JSON.stringify(metadata, null, 2),
					).open();
				}),
		});

		this.addCommand({
			id: 'update-active-note-frontmatter',
			name: 'Update active note frontmatter',
			checkCallback: (checking) =>
				this.runWithActiveFile(checking, (file) => {
					new FrontmatterModal(this.app, async (operation) => {
						if (operation.action === 'delete') {
							await this.api.deleteFrontmatter(file.path, operation.key);
						} else {
							await this.api.updateFrontmatter(
								file.path,
								operation.key,
								parseFrontmatterValue(operation.rawValue),
							);
						}
						new Notice(`Updated frontmatter in ${file.path}.`);
					}).open();
				}),
		});

		this.addCommand({
			id: 'show-vault-metadata',
			name: 'Show vault metadata summary',
			callback: () => {
				new TextViewerModal(
					this.app,
					'Vault metadata summary',
					JSON.stringify(this.api.getVaultMetadata(), null, 2),
				).open();
			},
		});
	}

	private runWithActiveFile(
		checking: boolean,
		action: (file: TFile) => void,
	): boolean {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md') {
			return false;
		}
		if (!checking) {
			action(file);
		}
		return true;
	}

	private run(action: () => Promise<void>): void {
		void action().catch((error: unknown) => new Notice(errorMessage(error)));
	}

	private async loadSettings(): Promise<void> {
		const saved = (await this.loadData()) as Partial<VaultToolkitSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
		if (this.settings.bearerToken.trim().length === 0) {
			this.settings.bearerToken = generateBearerToken();
			await this.saveSettings();
		}
	}

	private async startServer(showNotice = true): Promise<void> {
		const port = await this.mcpServer.start(this.settings);
		if (showNotice) {
			new Notice(
				`MCP server for ${this.app.vault.getName()} is running on port ${port}.`,
			);
		}
	}
}

function generateBearerToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function parseFrontmatterValue(rawValue: string): unknown {
	const trimmed = rawValue.trim();
	if (trimmed.length === 0) {
		return '';
	}

	try {
		return JSON.parse(trimmed) as unknown;
	} catch {
		return rawValue;
	}
}
