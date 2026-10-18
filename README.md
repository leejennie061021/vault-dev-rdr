# Simple Vault — неделя 8

Учебный контракт на Anchor 0.31.1 (Solana). Сейчас он делает следующее:

1. **Vault создан** — админ создаёт vault для SPL-токена.
2. **У каждого пользователя своя «карточка»** — пользователь создаёт личный аккаунт (PDA) внутри vault.

Контракт будет дорабатываться (депозиты, вывод и т.д.), поэтому сейчас он намеренно минимальный.

---

## Что делает контракт

```
initialize_vault    создаёт VaultState PDA, vault token account и share mint
create_user_card    создаёт UserCard PDA (с created_at); запрещено, если vault на паузе
close_user_card     закрывает UserCard, рента возвращается владельцу
set_paused          админ ставит vault на паузу / снимает с паузы
```

### `initialize_vault`

Вызывает админ (платит за аккаунты). Создаёт три аккаунта для выбранного `token_mint`:

| Аккаунт | Seeds | Что хранит |
|---|---|---|
| `vault_state` | `["vault", token_mint]` | admin, token_mint, адреса token account и share mint, bump |
| `vault_token_account` | `["vault_tokens", token_mint]` | токен-аккаунт, владелец — vault PDA |
| `share_mint` | `["share_mint", token_mint]` | mint для shares (6 decimals), authority — vault PDA |

### `create_user_card`

Вызывает любой пользователь (платит за свою карточку). Создаёт `UserCard`:

| Поле | Описание |
|---|---|
| `vault` | к какому vault относится карточка |
| `owner` | владелец карточки |
| `bump` | bump PDA |
| `created_at` | unix timestamp создания (`Clock::get()?.unix_timestamp`) |

Если `vault_state.paused == true`, вызов завершается ошибкой `VaultPaused`.

Seeds: `["user_card", vault_state, user]` — поэтому у одного пользователя в одном vault
может быть **только одна** карточка. Повторный вызов завершится ошибкой.

### `close_user_card`

Вызывает владелец карточки. Аккаунт `UserCard` закрывается (`close = owner`), рента возвращается владельцу.
Работает и на паузе. Чужую карточку закрыть нельзя (`has_one = owner` + seeds).

### `set_paused(paused: bool)`

Вызывает только админ vault (`has_one = admin`). Флаг `paused` в `VaultState` блокирует `create_user_card`.

---

## Требования

| Инструмент | Версия | Установка |
|---|---|---|
| Rust | stable | https://rustup.rs |
| Solana CLI | 1.18+ | https://docs.solana.com/cli/install-solana-cli-tools |
| Anchor CLI | 0.31.1 | `cargo install --git https://github.com/coral-xyz/anchor avm --locked && avm install 0.31.1 && avm use 0.31.1` |
| Node.js | 18+ | https://nodejs.org |
| Yarn | any | `npm i -g yarn` |

Rust-зависимости (`anchor-lang`, `anchor-spl` 0.31.1) подтянутся сами при `anchor build`.
JS-зависимости (`@coral-xyz/anchor`, `@solana/web3.js`, `@solana/spl-token`, `mocha`, `chai`, `typescript`) — через `yarn install`.

---

## Быстрый старт

### 1. Установить зависимости

```bash
cd vault-simple
yarn install
```

### 2. Сбилдить контракт

```bash
anchor build
```

Если билдишь **первый раз** (новый keypair):

```bash
anchor keys sync   # обновит declare_id! в lib.rs и Anchor.toml
anchor build       # пересобрать с правильным ID
```

Артефакты в `target/deploy/`:
- `simple_vault.so` — программа
- `simple_vault-keypair.json` — keypair (не коммитить!)

### 3. Настроить Solana CLI на devnet

```bash
solana config set --url devnet
solana address     # твой публичный ключ — запомни его
solana balance
```

### 4. Пополнить кошелёк

Для деплоя нужно ~2 SOL.

```bash
solana airdrop 2   # может не сработать из-за rate limit
```

Если rate limit — используй faucet:
- https://faucet.solana.com (вставь свой адрес)

### 5. Задеплоить

```bash
anchor deploy --provider.cluster devnet
```

### 6. Запустить тесты

```bash
yarn test
```

Ожидаемый вывод:

```
✔ initialize_vault: vault создан
✔ create_user_card: у каждого пользователя своя карточка
✔ create_user_card: вторая карточка для того же пользователя — ошибка
✔ set_paused: не-админ не может поставить паузу
✔ paused: на паузе карточку создать нельзя
✔ paused: после снятия с паузы карточка создаётся
✔ close_user_card: карточка закрыта, рента возвращена владельцу
✔ close_user_card: чужую карточку закрыть нельзя
8 passing
```

---

## Структура проекта

```
vault-simple/
├── programs/simple_vault/src/lib.rs   # контракт
├── tests/vault.ts                     # тесты
├── Anchor.toml
├── Cargo.toml
└── package.json
```

---

## Частые ошибки

| Ошибка | Причина | Решение |
|---|---|---|
| `Insufficient funds` при деплое | мало SOL | пополни кошелёк на devnet |
| `AccountNotInitialized` в тестах | программа не задеплоена или другой ID | `anchor keys sync` → `anchor build` → `anchor deploy` |
| `already in use` при `create_user_card` | у пользователя уже есть карточка | это ожидаемо, карточка одна на пользователя |

---

## Задания для практики (выполнено)

1. ✅ `UserCard.created_at` (`Clock::get()?.unix_timestamp`).
2. ✅ Инструкция `close_user_card` — закрывает карточку и возвращает ренту владельцу.
3. ✅ Флаг `paused` в `VaultState` + инструкция `set_paused`; на паузе `create_user_card` падает с `VaultPaused`.

> ⚠️ Размер `VaultState` и `UserCard` изменился. Для уже созданных на devnet аккаунтов
> схема не подойдёт — используй новый `token_mint` (новый vault) или передеплой программу.
