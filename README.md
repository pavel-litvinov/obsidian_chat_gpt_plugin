# Vault Toolkit for Obsidian

Локальний Obsidian-плагін на TypeScript для базових операцій із нотатками та metadata. Плагін не використовує мережу й працює через стандартний Obsidian API.

## MVP-команди

Відкрийте **Command palette** (`Cmd/Ctrl+P`) і знайдіть:

- **Vault Toolkit: Create note** — створює Markdown-нотатки, вкладені папки й необов'язкові теги.
- **Vault Toolkit: Search notes** — fuzzy-пошук за назвою або шляхом.
- **Vault Toolkit: Show active note contents** — читає active note; результат можна скопіювати.
- **Vault Toolkit: Append text to active note** — дописує Markdown у поточну нотатку.
- **Vault Toolkit: Inspect active note metadata** — показує шлях, timestamps, tags і frontmatter.
- **Vault Toolkit: Update active note frontmatter** — додає, змінює або видаляє властивість.
- **Vault Toolkit: Show vault metadata summary** — рахує нотатки, папки та використання тегів.

## Розробка

Потрібен Node.js 18 або новіший.

```bash
npm install
npm run typecheck
npm run lint
npm run build
```

Production build створює `main.js` у корені проєкту.

## Ручне встановлення

1. Створіть каталог `<Vault>/.obsidian/plugins/vault-toolkit/`.
2. Скопіюйте до нього `main.js`, `manifest.json` і `styles.css`.
3. Перезапустіть Obsidian або перезавантажте community plugins.
4. У **Settings → Community plugins** увімкніть **Vault Toolkit**.

## API для інших Obsidian-плагінів

Екземпляр плагіна має публічне поле `api`. Воно надає `createNote`, `readNote`, `readActiveNote`, `updateNote`, `searchNotes`, `getNoteMetadata`, `getVaultMetadata`, `findNotesByTag`, `updateFrontmatter` і `deleteFrontmatter`.

```ts
const toolkit = app.plugins.plugins['vault-toolkit'];
const active = await toolkit.api.readActiveNote();
await toolkit.api.updateFrontmatter(active.file.path, 'status', 'active');
```

Це локальний API між community plugins; він не відкриває HTTP endpoint.

## Публікація в Obsidian Community Plugins

Проєкт готовий до GitHub release через workflow `.github/workflows/release.yml`. Після публікації репозиторію:

1. Створіть і push-ніть semver tag, що точно збігається з `manifest.json`, наприклад `0.1.0` без префікса `v`.
2. Workflow збере `main.js` і створить GitHub release із `main.js`, `manifest.json` та `styles.css`.
3. Увійдіть на `community.obsidian.md`, зв'яжіть GitHub-акаунт і подайте URL репозиторію через **Plugins → New plugin**.

Plugin ID для каталогу — `vault-toolkit`. Він навмисно не містить зарезервованого слова `obsidian`.
