import {
	App,
	CachedMetadata,
	EventRef,
	getAllTags,
	normalizePath,
	TAbstractFile,
	TFile,
	TFolder,
} from 'obsidian';

export interface CreateNoteOptions {
	path: string;
	content?: string;
	frontmatter?: Record<string, unknown>;
}

export interface NoteMetadata {
	path: string;
	basename: string;
	extension: string;
	tags: string[];
	frontmatter: Record<string, unknown>;
	createdAt: number;
	modifiedAt: number;
	size: number;
}

export interface VaultMetadata {
	noteCount: number;
	folderCount: number;
	tagCounts: Record<string, number>;
	generatedAt: string;
}

export interface SearchNotesOptions {
	query?: string;
	tag?: string;
	tags?: string[];
	frontmatter?: Record<string, unknown>;
	limit?: number;
}

export type NoteUpdater =
	| string
	| ((currentContent: string) => string);

/** Public, local-only API that other Obsidian plugins can call. */
export class VaultToolkitApi {
	constructor(private readonly app: App) {}

	async createNote(options: CreateNoteOptions): Promise<TFile> {
		const path = normalizeNotePath(options.path);
		if (this.app.vault.getAbstractFileByPath(path) !== null) {
			throw new Error(`A file already exists at “${path}”.`);
		}

		await this.ensureParentFolders(path);
		const file = await this.app.vault.create(path, options.content ?? '');

		if (options.frontmatter !== undefined) {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
				assertFrontmatter(frontmatter);
				Object.assign(frontmatter, options.frontmatter);
			});
			await this.waitForFrontmatter(file, (frontmatter) =>
				Object.entries(options.frontmatter ?? {}).every(([key, expected]) =>
					valuesEqual(frontmatter[key], expected),
				),
			);
		}

		return file;
	}

	async readNote(path: string): Promise<string> {
		return this.app.vault.cachedRead(this.requireMarkdownFile(path));
	}

	async readActiveNote(): Promise<{ file: TFile; content: string }> {
		const file = this.app.workspace.getActiveFile();
		if (file === null || file.extension !== 'md') {
			throw new Error('No active Markdown note.');
		}

		return {
			file,
			content: await this.app.vault.cachedRead(file),
		};
	}

	async updateNote(path: string, update: NoteUpdater): Promise<TFile> {
		const file = this.requireMarkdownFile(path);
		await this.app.vault.process(file, (currentContent) =>
			typeof update === 'string' ? update : update(currentContent),
		);
		return file;
	}

	searchNotes(search: SearchNotesOptions | string): TFile[] {
		const options = typeof search === 'string' ? { query: search } : search;
		const normalizedQuery = options.query?.trim().toLocaleLowerCase() ?? '';
		const requestedTags = [
			...(options.tag === undefined ? [] : [options.tag]),
			...(options.tags ?? []),
		].map((tag) => stripHash(tag).toLocaleLowerCase());
		const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));

		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => {
				if (
					normalizedQuery.length > 0 &&
					!file.path.toLocaleLowerCase().includes(normalizedQuery)
				) {
					return false;
				}

				const metadata = this.getNoteMetadata(file);
				if (
					requestedTags.length > 0 &&
					!metadata.tags.some((tag) =>
						requestedTags.includes(tag.toLocaleLowerCase()),
					)
				) {
					return false;
				}

				return Object.entries(options.frontmatter ?? {}).every(
					([key, expected]) => valuesEqual(metadata.frontmatter[key], expected),
				);
			})
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, limit);
	}

	listNotes(limit = 200): string[] {
		return this.app.vault
			.getMarkdownFiles()
			.sort((left, right) => left.path.localeCompare(right.path))
			.slice(0, Math.max(1, Math.min(limit, 1000)))
			.map((file) => file.path);
	}

	getNoteMetadata(fileOrPath: TFile | string): NoteMetadata {
		const file =
			typeof fileOrPath === 'string'
				? this.requireMarkdownFile(fileOrPath)
				: fileOrPath;
		const cache = this.app.metadataCache.getFileCache(file);

		return {
			path: file.path,
			basename: file.basename,
			extension: file.extension,
			tags: readTags(cache),
			frontmatter: readFrontmatter(cache),
			createdAt: file.stat.ctime,
			modifiedAt: file.stat.mtime,
			size: file.stat.size,
		};
	}

	getVaultMetadata(): VaultMetadata {
		const files = this.app.vault.getMarkdownFiles();
		const tagCounts = new Map<string, number>();

		for (const file of files) {
			for (const tag of this.getNoteMetadata(file).tags) {
				tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			}
		}

		return {
			noteCount: files.length,
			folderCount: this.app.vault
				.getAllLoadedFiles()
				.filter((item) => item instanceof TFolder && item.path !== '/').length,
			tagCounts: Object.fromEntries(
				[...tagCounts.entries()].sort(([left], [right]) =>
					left.localeCompare(right),
				),
			),
			generatedAt: new Date().toISOString(),
		};
	}

	findNotesByTag(tag: string): TFile[] {
		const normalizedTag = stripHash(tag).toLocaleLowerCase();
		return this.app.vault.getMarkdownFiles().filter((file) =>
			this.getNoteMetadata(file).tags.some(
				(candidate) => candidate.toLocaleLowerCase() === normalizedTag,
			),
		);
	}

	async updateFrontmatter(
		path: string,
		key: string,
		value: unknown,
	): Promise<void> {
		const normalizedKey = key.trim();
		if (normalizedKey.length === 0) {
			throw new Error('Frontmatter key cannot be empty.');
		}

		const file = this.requireMarkdownFile(path);
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: unknown) => {
				assertFrontmatter(frontmatter);
				frontmatter[normalizedKey] = value;
			},
		);
		await this.waitForFrontmatter(file, (frontmatter) =>
			valuesEqual(frontmatter[normalizedKey], value),
		);
	}

	async deleteFrontmatter(path: string, key: string): Promise<void> {
		const normalizedKey = key.trim();
		if (normalizedKey.length === 0) {
			throw new Error('Frontmatter key cannot be empty.');
		}

		const file = this.requireMarkdownFile(path);
		await this.app.fileManager.processFrontMatter(
			file,
			(frontmatter: unknown) => {
				assertFrontmatter(frontmatter);
				delete frontmatter[normalizedKey];
			},
		);
		await this.waitForFrontmatter(
			file,
			(frontmatter) => !Object.prototype.hasOwnProperty.call(frontmatter, normalizedKey),
		);
	}

	private async waitForFrontmatter(
		file: TFile,
		predicate: (frontmatter: Record<string, unknown>) => boolean,
	): Promise<void> {
		if (predicate(readFrontmatter(this.app.metadataCache.getFileCache(file)))) {
			return;
		}

		await new Promise<void>((resolve) => {
			let eventRef: EventRef | null = null;
			const finish = (): void => {
				if (eventRef !== null) {
					this.app.metadataCache.offref(eventRef);
					eventRef = null;
				}
				window.clearTimeout(timeout);
				resolve();
			};
			const timeout = window.setTimeout(finish, 2000);

			eventRef = this.app.metadataCache.on('changed', (changedFile, _data, cache) => {
				if (changedFile.path === file.path && predicate(readFrontmatter(cache))) {
					finish();
				}
			});
		});
	}

	private requireMarkdownFile(path: string): TFile {
		const normalizedPath = normalizeNotePath(path);
		const item = this.app.vault.getAbstractFileByPath(normalizedPath);
		if (!(item instanceof TFile) || item.extension !== 'md') {
			throw new Error(`Markdown note not found: “${normalizedPath}”.`);
		}
		return item;
	}

	private async ensureParentFolders(path: string): Promise<void> {
		const segments = path.split('/').slice(0, -1);
		let currentPath = '';

		for (const segment of segments) {
			currentPath = currentPath.length === 0 ? segment : `${currentPath}/${segment}`;
			const existing = this.app.vault.getAbstractFileByPath(currentPath);
			if (existing === null) {
				await this.app.vault.createFolder(currentPath);
				continue;
			}
			this.assertFolder(existing, currentPath);
		}
	}

	private assertFolder(item: TAbstractFile, path: string): asserts item is TFolder {
		if (!(item instanceof TFolder)) {
			throw new Error(`Cannot create folder “${path}”: a file uses that path.`);
		}
	}
}

export function normalizeNotePath(input: string): string {
	const withoutLeadingSlash = input.trim().replaceAll('\\', '/').replace(/^\/+/, '');
	if (withoutLeadingSlash.length === 0) {
		throw new Error('Note path cannot be empty.');
	}

	const segments = withoutLeadingSlash.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new Error('Note path contains an invalid segment.');
	}

	const withExtension = withoutLeadingSlash.toLocaleLowerCase().endsWith('.md')
		? withoutLeadingSlash
		: `${withoutLeadingSlash}.md`;
	return normalizePath(withExtension);
}

function readTags(cache: CachedMetadata | null): string[] {
	if (cache === null) {
		return [];
	}
	return [...new Set((getAllTags(cache) ?? []).map(stripHash))].sort((left, right) =>
		left.localeCompare(right),
	);
}

function readFrontmatter(cache: CachedMetadata | null): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(cache?.frontmatter ?? {}).filter(([key]) => key !== 'position'),
	);
}

function stripHash(tag: string): string {
	return tag.startsWith('#') ? tag.slice(1) : tag;
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
	if (
		(typeof actual === 'string' || typeof actual === 'number') &&
		(typeof expected === 'string' || typeof expected === 'number')
	) {
		return String(actual).toLocaleLowerCase() === String(expected).toLocaleLowerCase();
	}
	return JSON.stringify(actual) === JSON.stringify(expected);
}

function assertFrontmatter(
	frontmatter: unknown,
): asserts frontmatter is Record<string, unknown> {
	if (
		typeof frontmatter !== 'object' ||
		frontmatter === null ||
		Array.isArray(frontmatter)
	) {
		throw new Error('Obsidian returned invalid frontmatter data.');
	}
}
