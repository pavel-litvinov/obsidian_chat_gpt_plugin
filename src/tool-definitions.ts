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
			'Search note paths and full Markdown content, with optional regex, tag, and frontmatter filters. Filters combine with AND; tags match any supplied tag.',
		inputSchema: {
			type: 'object',
			properties: {
				query: { type: 'string', description: 'Path or full-content text fragment.' },
				regex: { type: 'string', description: 'Regular expression applied to path and content.' },
				case_sensitive: { type: 'boolean', default: false },
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
		name: 'get_backlinks',
		description: 'List Markdown notes containing resolved wikilinks to a note.',
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Vault-relative note path.' } },
			required: ['path'],
		},
		annotations: readOnly,
	},
	{
		name: 'get_outgoing_links',
		description: 'List Markdown notes reached by resolved wikilinks from a note.',
		inputSchema: {
			type: 'object',
			properties: { path: { type: 'string', description: 'Vault-relative note path.' } },
			required: ['path'],
		},
		annotations: readOnly,
	},
	{
		name: 'get_graph_neighbors',
		description: 'Traverse incoming and outgoing wikilinks up to a bounded depth.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: 'Vault-relative note path.' },
				depth: { type: 'integer', minimum: 1, maximum: 10, default: 1 },
			},
			required: ['path'],
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
	{
		name: 'rename_note',
		description: 'Rename or move a note through Obsidian and update wikilinks across the vault.',
		inputSchema: {
			type: 'object',
			properties: {
				old_path: { type: 'string', description: 'Existing vault-relative note path.' },
				new_path: { type: 'string', description: 'New vault-relative note path.' },
			},
			required: ['old_path', 'new_path'],
		},
		annotations: safeUpdate,
	},
	{
		name: 'batch_write',
		description: 'Atomically create or update up to 100 notes. Any failure rolls back the entire batch.',
		inputSchema: {
			type: 'object',
			properties: {
				operations: {
					type: 'array',
					minItems: 1,
					maxItems: 100,
					items: {
						type: 'object',
						properties: {
							type: { type: 'string', enum: ['create', 'update'] },
							path: { type: 'string' },
							content: { type: 'string' },
							frontmatter: { type: 'object', additionalProperties: true },
						},
						required: ['type', 'path'],
						additionalProperties: false,
					},
				},
			},
			required: ['operations'],
		},
		annotations: {
			readOnlyHint: false,
			destructiveHint: true,
			idempotentHint: false,
		},
	},
	{
		name: 'create_from_template',
		description: 'Create a note from an Obsidian template using title, date, time, and custom variables.',
		inputSchema: {
			type: 'object',
			properties: {
				template_path: { type: 'string' },
				target_path: { type: 'string' },
				variables: { type: 'object', additionalProperties: true, default: {} },
			},
			required: ['template_path', 'target_path'],
		},
		annotations: additiveWrite,
	},
	{
		name: 'query_dataview',
		description: 'Execute a Dataview DQL query and return its result as JSON.',
		inputSchema: {
			type: 'object',
			properties: { dql_query: { type: 'string' } },
			required: ['dql_query'],
		},
		annotations: readOnly,
	},
];
