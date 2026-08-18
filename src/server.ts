import * as http from 'http';
import { App } from 'obsidian';
import { SearchNotesOptions, VaultToolkitApi } from './api';
import type { VaultToolkitSettings } from './settings';
import { TOOL_DEFINITIONS } from './tool-definitions';

const MCP_PROTOCOL_VERSION = '2025-06-18';
const MAX_REQUEST_BYTES = 1024 * 1024;

interface JsonRpcRequest {
	jsonrpc: '2.0';
	id?: number | string | null;
	method: string;
	params?: unknown;
}

interface ToolCallParams {
	name: string;
	arguments?: unknown;
}

export class VaultMcpServer {
	private server: http.Server | null = null;
	private token = '';
	private port: number | null = null;

	constructor(
		private readonly app: App,
		private readonly api: VaultToolkitApi,
		private readonly version: string,
	) {}

	get isRunning(): boolean {
		return this.server !== null;
	}

	get actualPort(): number | null {
		return this.port;
	}

	async start(settings: VaultToolkitSettings): Promise<number> {
		if (this.server !== null && this.port !== null) {
			return this.port;
		}

		this.token = settings.bearerToken.trim();
		if (this.token.length === 0) {
			throw new Error('A bearer token is required before the MCP server can start.');
		}
		for (let offset = 0; offset <= settings.portScanRange; offset += 1) {
			const candidatePort = settings.preferredPort + offset;
			const candidate = http.createServer((request, response) => {
				void this.handleHttpRequest(request, response);
			});

			try {
				await listen(candidate, candidatePort);
				this.server = candidate;
				this.port = candidatePort;
				return candidatePort;
			} catch (error) {
				candidate.close();
				if (!isAddressInUse(error)) {
					throw error;
				}
			}
		}

		throw new Error(
			`No free MCP port from ${settings.preferredPort} to ${settings.preferredPort + settings.portScanRange}.`,
		);
	}

	async stop(): Promise<void> {
		const current = this.server;
		this.server = null;
		this.port = null;
		if (current === null) {
			return;
		}
		await new Promise<void>((resolve, reject) => {
			current.close((error) => (error === undefined ? resolve() : reject(error)));
		});
	}

	private async handleHttpRequest(
		request: http.IncomingMessage,
		response: http.ServerResponse,
	): Promise<void> {
		try {
			if (request.method === 'GET' && request.url === '/health') {
				this.writeJson(response, 200, {
					status: 'ok',
					vault: {
						id: `${this.app.vault.getName()}@${this.port ?? 'unknown'}`,
						name: this.app.vault.getName(),
					},
					port: this.port,
					server: 'vault-toolkit-bridge',
					version: this.version,
					authentication: 'bearer',
				});
				return;
			}

			if (request.method !== 'POST' || request.url !== '/mcp') {
				this.writeJson(response, 404, { error: 'Not found' });
				return;
			}

			if (request.headers.origin !== undefined) {
				this.writeJson(response, 403, {
					error: 'Browser-originated MCP requests are not allowed.',
				});
				return;
			}

			if (!isJsonRequest(request)) {
				this.writeJson(response, 415, {
					error: 'Content-Type must be application/json.',
				});
				return;
			}

			if (!this.isAuthorized(request)) {
				this.writeJson(response, 401, { error: 'Unauthorized' });
				return;
			}

			const rpcRequest = parseRpcRequest(await readRequestBody(request));
			const rpcResponse = await this.handleRpcRequest(rpcRequest);
			if (rpcResponse === null) {
				response.writeHead(204);
				response.end();
				return;
			}
			this.writeJson(response, 200, rpcResponse);
		} catch (error) {
			this.writeJson(response, 500, {
				jsonrpc: '2.0',
				id: null,
				error: { code: -32603, message: errorMessage(error) },
			});
		}
	}

	private async handleRpcRequest(
		request: JsonRpcRequest,
	): Promise<Record<string, unknown> | null> {
		switch (request.method) {
			case 'initialize':
				return this.rpcResult(request.id, {
					protocolVersion: MCP_PROTOCOL_VERSION,
					serverInfo: { name: 'vault-toolkit-bridge', version: this.version },
					capabilities: { tools: {} },
				});
			case 'notifications/initialized':
				return null;
			case 'ping':
				return this.rpcResult(request.id, {});
			case 'tools/list':
				return this.rpcResult(request.id, { tools: TOOL_DEFINITIONS });
			case 'tools/call':
				return this.handleToolCall(request.id, parseToolCall(request.params));
			default:
				return request.id === undefined
					? null
					: this.rpcError(request.id, -32601, `Method not found: ${request.method}`);
		}
	}

	private async handleToolCall(
		id: JsonRpcRequest['id'],
		call: ToolCallParams,
	): Promise<Record<string, unknown>> {
		try {
			const result = await this.executeTool(call.name, asRecord(call.arguments));
			return this.rpcResult(id, {
				content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				structuredContent: result,
				isError: false,
			});
		} catch (error) {
			return this.rpcResult(id, {
				content: [{ type: 'text', text: errorMessage(error) }],
				isError: true,
			});
		}
	}

	private async executeTool(
		name: string,
		args: Record<string, unknown>,
	): Promise<Record<string, unknown>> {
		switch (name) {
			case 'read_note': {
				const path = requireString(args, 'path');
				return {
					path,
					content: await this.api.readNote(path),
					metadata: this.api.getNoteMetadata(path),
				};
			}
			case 'read_active_note': {
				const active = await this.api.readActiveNote();
				return {
					path: active.file.path,
					content: active.content,
					metadata: this.api.getNoteMetadata(active.file),
				};
			}
			case 'search_notes': {
				const options: SearchNotesOptions = {
					query: optionalString(args, 'query'),
					tag: optionalString(args, 'tag'),
					tags: optionalStringArray(args, 'tags'),
					frontmatter: optionalRecord(args, 'frontmatter'),
					limit: optionalInteger(args, 'limit'),
				};
				return {
					notes: this.api.searchNotes(options).map((file) =>
						this.api.getNoteMetadata(file),
					),
				};
			}
			case 'list_notes':
				return { notes: this.api.listNotes(optionalInteger(args, 'limit')) };
			case 'get_note_metadata':
				return { metadata: this.api.getNoteMetadata(requireString(args, 'path')) };
			case 'get_vault_metadata':
				return { metadata: this.api.getVaultMetadata() };
			case 'create_note': {
				const file = await this.api.createNote({
					path: requireString(args, 'path'),
					content: optionalString(args, 'content') ?? '',
					frontmatter: optionalRecord(args, 'frontmatter'),
				});
				return { path: file.path };
			}
			case 'update_note': {
				const file = await this.api.updateNote(
					requireString(args, 'path'),
					requireString(args, 'content'),
				);
				return { path: file.path };
			}
			case 'append_to_note': {
				const content = requireString(args, 'content');
				const file = await this.api.updateNote(requireString(args, 'path'), (current) => {
					const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
					return `${current}${separator}${content}\n`;
				});
				return { path: file.path };
			}
			case 'patch_note': {
				const oldText = requireString(args, 'old_text');
				const newText = requireString(args, 'new_text');
				const file = await this.api.updateNote(requireString(args, 'path'), (current) => {
					const occurrences = current.split(oldText).length - 1;
					if (occurrences !== 1) {
						throw new Error(
							`Expected old_text exactly once, but found ${occurrences} occurrences.`,
						);
					}
					return current.replace(oldText, newText);
				});
				return { path: file.path };
			}
			case 'update_frontmatter': {
				const path = requireString(args, 'path');
				const key = requireString(args, 'key');
				if (args.remove === true) {
					await this.api.deleteFrontmatter(path, key);
				} else {
					if (!Object.prototype.hasOwnProperty.call(args, 'value')) {
						throw new Error('value is required unless remove is true.');
					}
					await this.api.updateFrontmatter(path, key, args.value);
				}
				return { path, key, removed: args.remove === true };
			}
			default:
				throw new Error(`Unknown tool: ${name}`);
		}
	}

	private isAuthorized(request: http.IncomingMessage): boolean {
		return request.headers.authorization === `Bearer ${this.token}`;
	}

	private rpcResult(
		id: JsonRpcRequest['id'],
		result: Record<string, unknown>,
	): Record<string, unknown> {
		return { jsonrpc: '2.0', id: id ?? null, result };
	}

	private rpcError(
		id: JsonRpcRequest['id'],
		code: number,
		message: string,
	): Record<string, unknown> {
		return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
	}

	private writeJson(
		response: http.ServerResponse,
		status: number,
		body: Record<string, unknown>,
	): void {
		if (response.headersSent) {
			response.end();
			return;
		}
		response.writeHead(status, {
			'Cache-Control': 'no-store',
			'Content-Type': 'application/json; charset=utf-8',
			'X-Content-Type-Options': 'nosniff',
		});
		response.end(JSON.stringify(body));
	}
}

function isJsonRequest(request: http.IncomingMessage): boolean {
	const contentType = request.headers['content-type'];
	return (
		typeof contentType === 'string' &&
		/^application\/json(?:\s*;|$)/i.test(contentType)
	);
}

async function listen(server: http.Server, port: number): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const handleError = (error: Error): void => reject(error);
		server.once('error', handleError);
		server.listen(port, '127.0.0.1', () => {
			server.off('error', handleError);
			resolve();
		});
	});
}

async function readRequestBody(request: http.IncomingMessage): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const chunks: string[] = [];
		let size = 0;

		request.on('data', (chunk: unknown) => {
			let text: string;
			if (typeof chunk === 'string') {
				text = chunk;
			} else if (chunk instanceof Uint8Array) {
				text = Buffer.from(chunk).toString('utf8');
			} else {
				reject(new Error('Unsupported MCP request body.'));
				return;
			}

			size += Buffer.byteLength(text);
			if (size > MAX_REQUEST_BYTES) {
				reject(new Error('MCP request is too large.'));
				request.destroy();
				return;
			}
			chunks.push(text);
		});
		request.on('end', () => resolve(chunks.join('')));
		request.on('error', (error: Error) => reject(error));
	});
}

function parseRpcRequest(raw: string): JsonRpcRequest {
	const value: unknown = JSON.parse(raw);
	if (!isRecord(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string') {
		throw new Error('Invalid JSON-RPC request.');
	}
	return value as unknown as JsonRpcRequest;
}

function parseToolCall(value: unknown): ToolCallParams {
	if (!isRecord(value) || typeof value.name !== 'string') {
		throw new Error('Invalid tools/call parameters.');
	}
	return { name: value.name, arguments: value.arguments };
}

function asRecord(value: unknown): Record<string, unknown> {
	return value === undefined ? {} : requireRecordValue(value, 'arguments');
}

function optionalRecord(
	value: Record<string, unknown>,
	key: string,
): Record<string, unknown> | undefined {
	const candidate = value[key];
	return candidate === undefined ? undefined : requireRecordValue(candidate, key);
}

function requireRecordValue(value: unknown, key: string): Record<string, unknown> {
	if (!isRecord(value)) {
		throw new Error(`${key} must be an object.`);
	}
	return value;
}

function requireString(value: Record<string, unknown>, key: string): string {
	const candidate = value[key];
	if (typeof candidate !== 'string' || candidate.length === 0) {
		throw new Error(`${key} must be a non-empty string.`);
	}
	return candidate;
}

function optionalString(
	value: Record<string, unknown>,
	key: string,
): string | undefined {
	const candidate = value[key];
	if (candidate === undefined) {
		return undefined;
	}
	if (typeof candidate !== 'string') {
		throw new Error(`${key} must be a string.`);
	}
	return candidate;
}

function optionalStringArray(
	value: Record<string, unknown>,
	key: string,
): string[] | undefined {
	const candidate = value[key];
	if (candidate === undefined) {
		return undefined;
	}
	if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== 'string')) {
		throw new Error(`${key} must be an array of strings.`);
	}
	return candidate as string[];
}

function optionalInteger(
	value: Record<string, unknown>,
	key: string,
): number | undefined {
	const candidate = value[key];
	if (candidate === undefined) {
		return undefined;
	}
	if (!Number.isInteger(candidate)) {
		throw new Error(`${key} must be an integer.`);
	}
	return candidate as number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAddressInUse(error: unknown): boolean {
	return isRecord(error) && error.code === 'EADDRINUSE';
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
