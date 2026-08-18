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

export default class ObsidianVaultToolkitPlugin extends Plugin {
	/** API available to other plugins through Obsidian's plugin registry. */
	api!: VaultToolkitApi;

	onload(): void {
		this.api = new VaultToolkitApi(this.app);
		this.registerCommands();
	}

	private registerCommands(): void {
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
