export interface McpToolDefinition {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	annotations: Record<string, boolean>;
}

const readOnly = { readOnlyHint: true };
const additiveWrite = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: false,
};
const safeUpdate = {
	readOnlyHint: false,
	destructiveHint: false,
	idempotentHint: true,
};

export const TOOL_DEFINITIONS: McpToolDefinition[] = [
	{
		name: 'read_note',
		description: 'Read a Markdown note and its Obsidian metadata.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Vault-relative note path.' },
			},
			required: ['path'],
		},
		annotations: readOnly,
	},
	{
		name: 'read_active_note',
		description: 'Read the note currently active in this Obsidian vault window.',
		inputSchema: { type: 'object', properties: {} },
		annotations: readOnly,
	},
	{
		name: 'search_notes',
		description:
			'Search notes by path or title, tags, and frontmatter. Filters combine with AND; tags match any supplied tag.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Case-insensitive path or title fragment.' },
				tag: { type: 'string', description: 'A single tag, with or without #.' },
				tags: {
					type: 'array',
					items: { type: 'string' },
					description: 'Match any supplied tag.',
				},
				frontmatter: {
					type: 'object',
					additionalProperties: true,
					description: 'Exact frontmatter key/value filters.',
				},
				limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
			},
		},
		annotations: readOnly,
	},
	{
		name: 'list_notes',
		description: 'List Markdown notes in this vault, sorted by path.',
		inputSchema: {
			type: 'object',
			properties: {
				limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
			},
		},
		annotations: readOnly,
	},
	{
		name: 'get_note_metadata',
		description: "Get a note's path, timestamps, tags, and frontmatter.",
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' } },
			required: ['path'],
		},
		annotations: readOnly,
	},
	{
		name: 'get_vault_metadata',
		description: 'Summarize note count, folder count, and tag usage for this vault.',
		inputSchema: { type: 'object', properties: {} },
		annotations: readOnly,
	},
	{
		name: 'create_note',
		description:
			'Create a Markdown note, parent folders, and optional frontmatter. Fails if the note exists.',
		inputSchema: {
			type: 'object',
			properties: {
				path: {
					type: 'string',
					description: 'Vault-relative path; .md is added automatically.',
				},
				content: { type: 'string', default: '' },
				frontmatter: { type: 'object', additionalProperties: true },
			},
			required: ['path'],
		},
		annotations: additiveWrite,
	},
	{
		name: 'update_note',
		description: 'Replace the entire content of an existing note. Prefer patch_note for focused edits.',
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' }, content: { type: 'string' } },
			required: ['path', 'content'],
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: true,
		},
	},
	{
		name: 'append_to_note',
		description: 'Append Markdown text to an existing note.',
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string' }, content: { type: 'string' } },
			required: ['path', 'content'],
		},
		annotations: additiveWrite,
	},
	{
		name: 'patch_note',
		description:
			'Replace one exact, unique string in a note. Include surrounding context when necessary.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string' },
				old_text: { type: 'string' },
				new_text: { type: 'string' },
			},
			required: ['path', 'old_text', 'new_text'],
		},
		annotations: safeUpdate,
	},
	{
		name: 'update_frontmatter',
		description:
			"Set or remove one frontmatter property using Obsidian's atomic frontmatter API.",
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string' },
				key: { type: 'string' },
				value: { description: 'JSON-compatible value to set.' },
				remove: {
					type: 'boolean',
					default: false,
					description: 'Remove the property instead of setting it.',
				},
			},
			required: ['path', 'key'],
		},
		annotations: safeUpdate,
	},
];
