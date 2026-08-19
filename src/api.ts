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
	regex?: string;
	caseSensitive?: boolean;
	tag?: string;
	tags?: string[];
	frontmatter?: Record<string, unknown>;
	limit?: number;
}

export interface SearchMatch {
	path: string;
	metadata: NoteMetadata;
	matchedIn: Array<'path' | 'content'>;
	excerpt?: string;
}

export interface BatchWriteOperation {
	type: 'create' | 'update';
	path: string;
	content?: string;
	frontmatter?: Record<string, unknown>;
}

export interface GraphNeighbor {
	path: string;
	distance: number;
}

export interface GraphEdge {
	from: string;
	to: string;
}

export interface DataviewQueryResult {
	successful: true;
	value: unknown;
}

export class VaultToolkitError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly details?: Record<string, unknown>,
	) {
		super(message);
		this.name = 'VaultToolkitError';
	}
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
			throw new VaultToolkitError('FILE_EXISTS', `A file already exists at “${path}”.`);
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

	async searchNotesFullText(search: SearchNotesOptions | string): Promise<SearchMatch[]> {
		const options = typeof search === 'string' ? { query: search } : search;
		const query = options.query?.trim() ?? '';
		const caseSensitive = options.caseSensitive ?? false;
		const normalizedQuery = caseSensitive ? query : query.toLocaleLowerCase();
		const requestedTags = [
			...(options.tag === undefined ? [] : [options.tag]),
			...(options.tags ?? []),
		].map((tag) => stripHash(caseSensitive ? tag : tag.toLocaleLowerCase()));
		const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
		let pattern: RegExp | undefined;
		if (options.regex !== undefined) {
			try {
				pattern = new RegExp(options.regex, caseSensitive ? 'u' : 'iu');
			} catch (error) {
				throw new VaultToolkitError('INVALID_REGEX', `Invalid regular expression: ${errorMessage(error)}`);
			}
		}

		const candidates = this.app.vault.getMarkdownFiles().filter((file) => {
			const metadata = this.getNoteMetadata(file);
			if (
				requestedTags.length > 0 &&
				!metadata.tags.some((tag) =>
					requestedTags.includes(caseSensitive ? tag : tag.toLocaleLowerCase()),
				)
			) {
				return false;
			}
			return Object.entries(options.frontmatter ?? {}).every(
				([key, expected]) => valuesEqual(metadata.frontmatter[key], expected),
			);
		});

		const matches: SearchMatch[] = [];
		for (const file of candidates.sort((left, right) => left.path.localeCompare(right.path))) {
			const content = await this.app.vault.cachedRead(file);
			const searchablePath = caseSensitive ? file.path : file.path.toLocaleLowerCase();
			const searchableContent = caseSensitive ? content : content.toLocaleLowerCase();
			const pathQueryMatch = normalizedQuery.length > 0 && searchablePath.includes(normalizedQuery);
			const contentQueryMatch =
				normalizedQuery.length > 0 && searchableContent.includes(normalizedQuery);
			const pathRegexMatch = pattern?.test(file.path) ?? false;
			pattern && (pattern.lastIndex = 0);
			const contentRegexMatch = pattern?.test(content) ?? false;
			pattern && (pattern.lastIndex = 0);

			if (normalizedQuery.length > 0 && !pathQueryMatch && !contentQueryMatch) {
				continue;
			}
			if (pattern !== undefined && !pathRegexMatch && !contentRegexMatch) {
				continue;
			}

			const matchedIn: Array<'path' | 'content'> = [];
			if (pathQueryMatch || pathRegexMatch) matchedIn.push('path');
			if (contentQueryMatch || contentRegexMatch) matchedIn.push('content');
			const matchIndex = findFirstMatchIndex(content, normalizedQuery, pattern, caseSensitive);
			matches.push({
				path: file.path,
				metadata: this.getNoteMetadata(file),
				matchedIn,
				...(matchIndex === -1 ? {} : { excerpt: excerptAround(content, matchIndex) }),
			});
			if (matches.length >= limit) break;
		}
		return matches;
	}

	getBacklinks(path: string): string[] {
		const target = this.requireMarkdownFile(path).path;
		return Object.entries(this.app.metadataCache.resolvedLinks)
			.filter(([, destinations]) => (destinations[target] ?? 0) > 0)
			.map(([source]) => source)
			.filter((source) => this.isMarkdownPath(source))
			.sort((left, right) => left.localeCompare(right));
	}

	getOutgoingLinks(path: string): string[] {
		const source = this.requireMarkdownFile(path).path;
		return Object.keys(this.app.metadataCache.resolvedLinks[source] ?? {})
			.filter((target) => this.isMarkdownPath(target))
			.sort((left, right) => left.localeCompare(right));
	}

	getGraphNeighbors(path: string, depth = 1): {
		root: string;
		neighbors: GraphNeighbor[];
		edges: GraphEdge[];
	} {
		const root = this.requireMarkdownFile(path).path;
		if (!Number.isInteger(depth) || depth < 1 || depth > 10) {
			throw new VaultToolkitError('INVALID_ARGUMENT', 'depth must be an integer from 1 to 10.');
		}
		const distances = new Map<string, number>([[root, 0]]);
		const queue = [root];
		const edges = new Map<string, GraphEdge>();

		while (queue.length > 0) {
			const current = queue.shift();
			if (current === undefined) break;
			const distance = distances.get(current) ?? 0;
			if (distance >= depth) continue;
			const related = new Set([
				...this.getOutgoingLinks(current),
				...this.getBacklinks(current),
			]);
			for (const neighbor of related) {
				if (this.app.metadataCache.resolvedLinks[current]?.[neighbor] !== undefined) {
					edges.set(`${current}\u0000${neighbor}`, { from: current, to: neighbor });
				}
				if (this.app.metadataCache.resolvedLinks[neighbor]?.[current] !== undefined) {
					edges.set(`${neighbor}\u0000${current}`, { from: neighbor, to: current });
				}
				if (!distances.has(neighbor)) {
					distances.set(neighbor, distance + 1);
					queue.push(neighbor);
				}
			}
		}

		return {
			root,
			neighbors: [...distances.entries()]
				.filter(([candidate]) => candidate !== root)
				.map(([neighborPath, distance]) => ({ path: neighborPath, distance }))
				.sort((left, right) => left.distance - right.distance || left.path.localeCompare(right.path)),
			edges: [...edges.values()].sort(
				(left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
			),
		};
	}

	async renameNote(oldPath: string, newPath: string): Promise<TFile> {
		const file = this.requireMarkdownFile(oldPath);
		const target = normalizeNotePath(newPath);
		if (file.path === target) return file;
		if (this.app.vault.getAbstractFileByPath(target) !== null) {
			throw new VaultToolkitError('TARGET_EXISTS', `A file already exists at “${target}”.`);
		}
		await this.ensureParentFolders(target);
		await this.app.fileManager.renameFile(file, target);
		return this.requireMarkdownFile(target);
	}

	async batchWrite(operations: BatchWriteOperation[]): Promise<string[]> {
		if (operations.length === 0) {
			throw new VaultToolkitError('INVALID_ARGUMENT', 'operations cannot be empty.');
		}
		if (operations.length > 100) {
			throw new VaultToolkitError('INVALID_ARGUMENT', 'A batch may contain at most 100 operations.');
		}
		const normalized = operations.map((operation) => ({
			...operation,
			path: normalizeNotePath(operation.path),
		}));
		const paths = normalized.map((operation) => operation.path);
		if (new Set(paths).size !== paths.length) {
			throw new VaultToolkitError('DUPLICATE_PATH', 'Each path may appear only once in a batch.');
		}
		const originals = new Map<string, string>();
		for (const operation of normalized) {
			const existing = this.app.vault.getAbstractFileByPath(operation.path);
			if (operation.type === 'create' && existing !== null) {
				throw new VaultToolkitError('FILE_EXISTS', `A file already exists at “${operation.path}”.`);
			}
			if (operation.type === 'update') {
				if (!(existing instanceof TFile) || existing.extension !== 'md') {
					throw new VaultToolkitError('NOTE_NOT_FOUND', `Markdown note not found: “${operation.path}”.`);
				}
				if (operation.content === undefined && operation.frontmatter === undefined) {
					throw new VaultToolkitError('INVALID_ARGUMENT', `Update for “${operation.path}” has no changes.`);
				}
				originals.set(operation.path, await this.app.vault.read(existing));
			}
		}

		const createdFiles: string[] = [];
		const createdFolders = new Set<string>();
		const touchedUpdates: string[] = [];
		try {
			for (const operation of normalized) {
				let file: TFile;
				if (operation.type === 'create') {
					await this.ensureParentFolders(operation.path, createdFolders);
					file = await this.app.vault.create(operation.path, operation.content ?? '');
					createdFiles.push(file.path);
				} else {
					file = this.requireMarkdownFile(operation.path);
					touchedUpdates.push(operation.path);
					if (operation.content !== undefined) await this.app.vault.modify(file, operation.content);
				}
				if (operation.frontmatter !== undefined) {
					await this.app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
						assertFrontmatter(frontmatter);
						Object.assign(frontmatter, operation.frontmatter);
					});
				}
			}
			return paths;
		} catch (error) {
			const rollbackErrors: string[] = [];
			for (const path of [...touchedUpdates].reverse()) {
				try {
					const content = originals.get(path);
					if (content === undefined) continue;
					await this.app.vault.modify(this.requireMarkdownFile(path), content);
				} catch (rollbackError) {
					rollbackErrors.push(`${path}: ${errorMessage(rollbackError)}`);
				}
			}
			for (const path of [...createdFiles].reverse()) {
				try {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file !== null) await this.app.fileManager.trashFile(file);
				} catch (rollbackError) {
					rollbackErrors.push(`${path}: ${errorMessage(rollbackError)}`);
				}
			}
			await this.removeEmptyFolders(createdFolders, rollbackErrors);
			if (rollbackErrors.length > 0) {
				throw new VaultToolkitError('BATCH_ROLLBACK_FAILED', 'Batch failed and rollback was incomplete.', {
					cause: errorMessage(error),
					rollbackErrors,
				});
			}
			throw new VaultToolkitError('BATCH_FAILED', `Batch failed and was rolled back: ${errorMessage(error)}`);
		}
	}

	async createFromTemplate(
		templatePath: string,
		targetPath: string,
		variables: Record<string, unknown> = {},
	): Promise<TFile> {
		const template = await this.readNote(templatePath);
		const target = normalizeNotePath(targetPath);
		const title = target.split('/').at(-1)?.replace(/\.md$/i, '') ?? target;
		const now = new Date();
		const standard: Record<string, unknown> = {
			title,
			date: formatTemplateDate(now, 'YYYY-MM-DD'),
			time: formatTemplateDate(now, 'HH:mm'),
		};
		let content = template.replace(/\{\{\s*(date|time):([^}]+)\}\}/gu, (_match, _kind: string, format: string) =>
			formatTemplateDate(now, format.trim()),
		);
		for (const [key, value] of Object.entries({ ...standard, ...variables })) {
			const placeholder = new RegExp(`\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\}`, 'gu');
			content = content.replace(placeholder, stringifyTemplateValue(value));
		}
		return this.createNote({ path: target, content });
	}

	async queryDataview(query: string): Promise<DataviewQueryResult> {
		const plugins = (this.app as AppWithPlugins).plugins;
		const plugin = plugins?.getPlugin('dataview') as DataviewPlugin | null | undefined;
		if (plugin?.api?.query === undefined) {
			throw new VaultToolkitError(
				'DATAVIEW_NOT_INSTALLED',
				'Dataview is not installed or enabled in this vault.',
			);
		}
		const result = await plugin.api.query(query);
		if (!result.successful) {
			throw new VaultToolkitError('DATAVIEW_QUERY_FAILED', result.error ?? 'Dataview query failed.');
		}
		return { successful: true, value: toJsonSafe(result.value) };
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
			throw new VaultToolkitError('NOTE_NOT_FOUND', `Markdown note not found: “${normalizedPath}”.`);
		}
		return item;
	}

	private async ensureParentFolders(path: string, created?: Set<string>): Promise<void> {
		const segments = path.split('/').slice(0, -1);
		let currentPath = '';

		for (const segment of segments) {
			currentPath = currentPath.length === 0 ? segment : `${currentPath}/${segment}`;
			const existing = this.app.vault.getAbstractFileByPath(currentPath);
			if (existing === null) {
				await this.app.vault.createFolder(currentPath);
				created?.add(currentPath);
				continue;
			}
			this.assertFolder(existing, currentPath);
		}
	}

	private isMarkdownPath(path: string): boolean {
		const item = this.app.vault.getAbstractFileByPath(path);
		return item instanceof TFile && item.extension === 'md';
	}

	private async removeEmptyFolders(paths: Set<string>, errors: string[]): Promise<void> {
		const deepestFirst = [...paths].sort((left, right) => right.length - left.length);
		for (const path of deepestFirst) {
			const folder = this.app.vault.getAbstractFileByPath(path);
			if (!(folder instanceof TFolder) || folder.children.length > 0) continue;
			try {
				await this.app.fileManager.trashFile(folder);
			} catch (error) {
				errors.push(`${path}: ${errorMessage(error)}`);
			}
		}
	}

	private assertFolder(item: TAbstractFile, path: string): asserts item is TFolder {
		if (!(item instanceof TFolder)) {
			throw new Error(`Cannot create folder “${path}”: a file uses that path.`);
		}
	}
}

interface DataviewQueryResponse {
	successful: boolean;
	value?: unknown;
	error?: string;
}

interface DataviewPlugin {
	api?: { query: (query: string) => Promise<DataviewQueryResponse> };
}

interface AppWithPlugins extends App {
	plugins?: { getPlugin: (id: string) => unknown };
}

export function normalizeNotePath(input: string): string {
	const withoutLeadingSlash = input.trim().replaceAll('\\', '/').replace(/^\/+/, '');
	if (withoutLeadingSlash.length === 0) {
		throw new VaultToolkitError('INVALID_PATH', 'Note path cannot be empty.');
	}

	const segments = withoutLeadingSlash.split('/');
	if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
		throw new VaultToolkitError('INVALID_PATH', 'Note path contains an invalid segment.');
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

function findFirstMatchIndex(
	content: string,
	query: string,
	pattern: RegExp | undefined,
	caseSensitive: boolean,
): number {
	if (query.length > 0) {
		const haystack = caseSensitive ? content : content.toLocaleLowerCase();
		const index = haystack.indexOf(query);
		if (index !== -1) return index;
	}
	if (pattern === undefined) return -1;
	const match = pattern.exec(content);
	pattern.lastIndex = 0;
	return match?.index ?? -1;
}

function excerptAround(content: string, index: number): string {
	const start = Math.max(0, index - 80);
	const end = Math.min(content.length, index + 160);
	return `${start > 0 ? '…' : ''}${content.slice(start, end).replace(/\s+/gu, ' ').trim()}${end < content.length ? '…' : ''}`;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function formatTemplateDate(date: Date, format: string): string {
	const values: Record<string, string> = {
		YYYY: String(date.getFullYear()),
		YY: String(date.getFullYear()).slice(-2),
		MM: String(date.getMonth() + 1).padStart(2, '0'),
		M: String(date.getMonth() + 1),
		DD: String(date.getDate()).padStart(2, '0'),
		D: String(date.getDate()),
		HH: String(date.getHours()).padStart(2, '0'),
		H: String(date.getHours()),
		mm: String(date.getMinutes()).padStart(2, '0'),
		m: String(date.getMinutes()),
		ss: String(date.getSeconds()).padStart(2, '0'),
		s: String(date.getSeconds()),
	};
	return format.replace(/YYYY|YY|MM|DD|HH|mm|ss|M|D|H|m|s/gu, (token) => values[token] ?? token);
}

function stringifyTemplateValue(value: unknown): string {
	return typeof value === 'string' ? value : JSON.stringify(value) ?? '';
}

function toJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'bigint') return value.toString();
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, seen));
	if (typeof value !== 'object') return null;
	if (seen.has(value)) return '[Circular]';
	seen.add(value);
	const record = value as Record<string, unknown>;
	const arrayMethod = record.array;
	if (isNoArgMethod(arrayMethod)) {
		const result = toJsonSafe(arrayMethod.call(value), seen);
		seen.delete(value);
		return result;
	}
	const toIsoMethod = record.toISO;
	if (isNoArgMethod(toIsoMethod)) {
		const result = toIsoMethod.call(value);
		seen.delete(value);
		return result;
	}
	const result = Object.fromEntries(
		Object.entries(record).map(([key, item]) => [key, toJsonSafe(item, seen)]),
	);
	seen.delete(value);
	return result;
}

function isNoArgMethod(value: unknown): value is (this: object) => unknown {
	return typeof value === 'function';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
