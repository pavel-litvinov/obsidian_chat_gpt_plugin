import {
	App,
	DropdownComponent,
	FuzzySuggestModal,
	Modal,
	Notice,
	Setting,
	TFile,
} from 'obsidian';

export interface CreateNoteFormValue {
	path: string;
	content: string;
	tags: string[];
}

export type FrontmatterOperation =
	| { action: 'set'; key: string; rawValue: string }
	| { action: 'delete'; key: string };

export class CreateNoteModal extends Modal {
	private path = '';
	private content = '';
	private tags = '';

	constructor(
		app: App,
		private readonly onSubmit: (value: CreateNoteFormValue) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Create note');
		new Setting(this.contentEl)
			.setName('Note path')
			.setDesc('Vault-relative path; .md is added automatically.')
			.addText((text) =>
				text
					.setPlaceholder('Projects/new note')
					.onChange((value) => (this.path = value)),
			);
		new Setting(this.contentEl)
			.setName('Initial content')
			.addTextArea((text) =>
				text
					.setPlaceholder('Optional Markdown content')
					.onChange((value) => (this.content = value)),
			);
		new Setting(this.contentEl)
			.setName('Tags')
			.setDesc('Optional comma-separated tags.')
			.addText((text) =>
				text
					.setPlaceholder('Project, draft')
					.onChange((value) => (this.tags = value)),
			);
		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Create')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		try {
			await this.onSubmit({
				path: this.path,
				content: this.content,
				tags: this.tags
					.split(',')
					.map((tag) => tag.trim().replace(/^#/, ''))
					.filter((tag) => tag.length > 0),
			});
			this.close();
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}
}

export class NoteSearchModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private readonly files: TFile[]) {
		super(app);
		this.setPlaceholder('Search notes by name or path…');
	}

	getItems(): TFile[] {
		return this.files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onChooseItem(file: TFile): void {
		void this.app.workspace.getLeaf(true).openFile(file);
	}
}

export class TextViewerModal extends Modal {
	constructor(
		app: App,
		private readonly title: string,
		private readonly text: string,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle(this.title);
		const textArea = this.contentEl.createEl('textarea', {
			cls: 'ovt-text-viewer',
		});
		textArea.value = this.text;
		textArea.readOnly = true;

		new Setting(this.contentEl).addButton((button) =>
			button.setButtonText('Copy').onClick(() => {
				void navigator.clipboard.writeText(this.text).then(
					() => new Notice('Copied to clipboard.'),
					() => new Notice('Could not copy to clipboard.'),
				);
			}),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class AppendTextModal extends Modal {
	private text = '';

	constructor(
		app: App,
		private readonly onSubmit: (text: string) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Append to active note');
		new Setting(this.contentEl).setName('Markdown text').addTextArea((textArea) =>
			textArea
				.setPlaceholder('Text to append')
				.onChange((value) => (this.text = value)),
		);
		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Append')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async submit(): Promise<void> {
		if (this.text.length === 0) {
			new Notice('Enter text to append.');
			return;
		}
		try {
			await this.onSubmit(this.text);
			this.close();
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}
}

export class FrontmatterModal extends Modal {
	private action: 'set' | 'delete' = 'set';
	private key = '';
	private rawValue = '';
	private valueSetting?: Setting;

	constructor(
		app: App,
		private readonly onSubmit: (
			operation: FrontmatterOperation,
		) => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		this.setTitle('Update active note frontmatter');
		new Setting(this.contentEl).setName('Operation').addDropdown((dropdown) =>
			this.configureDropdown(dropdown),
		);
		new Setting(this.contentEl).setName('Property').addText((text) =>
			text.setPlaceholder('Status').onChange((value) => (this.key = value)),
		);
		this.valueSetting = new Setting(this.contentEl)
			.setName('Value')
			.setDesc('JSON values are parsed; other input is saved as text.')
			.addTextArea((text) =>
				text
					.setPlaceholder('"active", true, 42, ["a", "b"]')
					.onChange((value) => (this.rawValue = value)),
			);
		new Setting(this.contentEl).addButton((button) =>
			button
				.setButtonText('Apply')
				.setCta()
				.onClick(() => void this.submit()),
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private configureDropdown(dropdown: DropdownComponent): void {
		dropdown
			.addOption('set', 'Set value')
			.addOption('delete', 'Delete property')
			.onChange((value) => {
				this.action = value === 'delete' ? 'delete' : 'set';
				this.valueSetting?.settingEl.toggle(this.action === 'set');
			});
	}

	private async submit(): Promise<void> {
		try {
			const operation: FrontmatterOperation =
				this.action === 'delete'
					? { action: 'delete', key: this.key }
					: { action: 'set', key: this.key, rawValue: this.rawValue };
			await this.onSubmit(operation);
			this.close();
		} catch (error) {
			new Notice(errorMessage(error));
		}
	}
}

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
